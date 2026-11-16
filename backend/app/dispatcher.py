import time
from datetime import timedelta

from gridfs import GridFSBucket
from pymongo import MongoClient
from redis import Redis

from app.config import get_settings
from app.database import ensure_indexes, seed_parser_catalog, utcnow
from app.registry import validate_parser_catalog
from app.jobs import release_capacity

settings = get_settings()
STREAMS = {"upload": "pdf:work:upload", "corpus": "pdf:work:corpus"}


def beat(db, redis_client):
    now = utcnow()
    queue = {}
    for kind, stream in STREAMS.items():
        queue[kind] = redis_client.xlen(stream)
    oldest = db.work_items.find_one({"status": "queued", "ready": True}, sort=[("created_at", 1)])
    storage = next(db.artifacts.files.aggregate([{"$group": {"_id": None, "bytes": {"$sum": "$length"}}}]), {"bytes": 0})
    db.service_heartbeats.update_one(
        {"_id": "dispatcher"},
        {"$set": {
            "updated_at": now,
            "queued_work_count": db.work_items.count_documents({"status": "queued", "ready": True}),
            "oldest_queued_age_seconds": max(0, int((now - oldest["created_at"]).total_seconds())) if oldest else 0,
            "stream_lengths": queue,
            "storage_bytes": storage.get("bytes", 0),
            "max_storage_bytes": settings.queue_max_bytes,
            "retries_total": db.work_items.count_documents({"attempt_count": {"$gt": 1}}),
            "timeouts_total": db.results.count_documents({"error_type": "timeout"}),
            "memory_failures_total": db.results.count_documents({"error_type": "memory_failure"}),
        }},
        upsert=True,
    )


def reconcile(db, redis_client):
    now = utcnow()
    # A stale lease is safe to requeue after worker loss; attempt IDs prevent stale commits.
    db.work_items.update_many(
        {"status": "running", "lease_expires_at": {"$lte": now}},
        {"$set": {"status": "queued", "ready": True, "dispatch_state": "pending", "dispatch_at": now, "lease_expires_at": None}},
    )
    # Reconcile a Mongo-committed work result if a worker died before writing its result index.
    for item in db.work_items.find({"status": {"$in": ["completed", "failed"]}, "result": {"$exists": True}}).limit(500):
        db.results.replace_one({"_id": item["_id"]}, item["result"], upsert=True)

    for job in db.jobs.find({"status": {"$in": ["queued", "running"]}}).limit(500):
        complete = db.results.count_documents({"job_id": job["_id"]})
        failed = db.results.count_documents({"job_id": job["_id"], "status": "failed"})
        if complete >= job["total_work"]:
            status = "completed_with_errors" if failed else "completed"
            finished_at = utcnow()
            db.jobs.update_one({"_id": job["_id"], "status": {"$in": ["queued", "running"]}}, {"$set": {
                "status": status, "completed_work": complete, "failed_work": failed,
                "updated_at": finished_at, "finished_at": finished_at,
                "expires_at": finished_at + timedelta(hours=settings.private_job_retention_hours),
            }})
            release_capacity(db, job)
            from app.worker import publish_report
            publish_report(db, job)
        else:
            db.jobs.update_one({"_id": job["_id"]}, {"$set": {"completed_work": complete, "failed_work": failed}})
            running = db.work_items.count_documents({"job_id": job["_id"], "status": "running"})
            ready = db.work_items.count_documents({"job_id": job["_id"], "status": "queued", "ready": True})
            if not running and not ready:
                following = db.work_items.find_one({"job_id": job["_id"], "status": "queued"}, sort=[("sequence", 1)])
                if following:
                    db.work_items.update_one({"_id": following["_id"], "status": "queued"}, {"$set": {"ready": True, "dispatch_state": "pending", "dispatch_at": utcnow()}})

    candidates = db.work_items.find({
        "status": "queued", "ready": True,
        "$or": [
            {"dispatch_state": "pending"},
            {"last_dispatched_at": {"$lte": now - timedelta(seconds=30)}},
            {"last_dispatched_at": {"$exists": False}},
        ],
    }).sort([("stream", 1), ("dispatch_at", 1)]).limit(100)
    for item in candidates:
        stream = STREAMS[item["stream"]]
        message_id = redis_client.xadd(stream, {"work_id": item["_id"]})
        db.work_items.update_one(
            {"_id": item["_id"], "status": "queued"},
            {"$set": {"dispatch_state": "published", "last_dispatched_at": now, "last_stream_entry_id": message_id}},
        )


def cleanup_expired(db, bucket):
    now = utcnow()
    expired = list(db.jobs.find({"expires_at": {"$lte": now}}).limit(100))
    for job in expired:
        report = db.published_reports.find_one({"_id": job["_id"]}) if job.get("kind") == "corpus" else None
        if report:
            # Published corpus results and GridFS outputs are retained for rescoring.
            db.jobs.delete_one({"_id": job["_id"]})
            db.work_items.delete_many({"job_id": job["_id"]})
            continue
        results = list(db.results.find({"job_id": job["_id"]}))
        file_ids = {job.get("source_file_id")}
        for result in results:
            file_ids.update([result.get("output_file_id"), result.get("reference_file_id")])
        for item in db.work_items.find({"job_id": job["_id"]}):
            file_ids.add(item.get("reference_file_id"))
        for file_id in file_ids - {None}:
            try:
                bucket.delete(file_id)
            except Exception:
                pass
        db.results.delete_many({"job_id": job["_id"]})
        db.work_items.delete_many({"job_id": job["_id"]})
        db.jobs.delete_one({"_id": job["_id"]})

    # Delete old GridFS files that are no longer referenced by any active or published data.
    refs = set()
    for collection, fields in (
        (db.dataset_documents, ("pdf_file_id", "reference_file_id")),
        (db.jobs, ("source_file_id",)),
        (db.work_items, ("file_id", "reference_file_id")),
        (db.results, ("output_file_id", "reference_file_id")),
    ):
        projection = {field: 1 for field in fields}
        for record in collection.find({}, projection):
            refs.update(record.get(field) for field in fields if record.get(field))
    cutoff = now - timedelta(hours=1)
    for artifact in db.artifacts.files.find({"uploadDate": {"$lte": cutoff}}, {"_id": 1}).limit(500):
        if artifact["_id"] not in refs:
            try:
                bucket.delete(artifact["_id"])
            except Exception:
                pass


def main():
    mongo = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    db = mongo.get_default_database()
    ensure_indexes(db)
    seed_parser_catalog(db)
    validate_parser_catalog(db)
    bucket = GridFSBucket(db, bucket_name="artifacts")
    cleanup_deadline = 0
    while True:
        try:
            reconcile(db, redis_client)
            beat(db, redis_client)
            if time.monotonic() >= cleanup_deadline:
                cleanup_expired(db, bucket)
                cleanup_deadline = time.monotonic() + 60
        except Exception as exc:
            print(f"dispatcher iteration failed: {type(exc).__name__}", flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
