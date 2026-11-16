import hashlib
import json
import os
import resource
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import timedelta
from importlib import metadata

from gridfs import GridFSBucket
from pymongo import MongoClient, ReturnDocument
from redis import Redis
from rapidfuzz.distance.Levenshtein import distance as levenshtein_distance

from app.config import get_settings
from app.database import ensure_indexes, seed_parser_catalog, utcnow
from app.registry import validate_parser_catalog

settings = get_settings()
GROUP = "pdf-workers"
STREAMS = {"upload": "pdf:work:upload", "corpus": "pdf:work:corpus"}
MAX_CAPTURE_BYTES = 32 * 1024 * 1024
PARSER_ADDRESS_SPACE_BYTES = 768 * 1024 * 1024


def limit_parser_process():
    resource.setrlimit(resource.RLIMIT_AS, (PARSER_ADDRESS_SPACE_BYTES, PARSER_ADDRESS_SPACE_BYTES))


def heartbeat(db, active_work=None):
    db.service_heartbeats.update_one(
        {"_id": "worker"},
        {"$set": {"updated_at": utcnow(), "worker_id": settings.worker_id, "active_work": active_work}},
        upsert=True,
    )


def heartbeat_loop(db, stop, active):
    while not stop.wait(10):
        heartbeat(db, active.get("work_id"))


def read_gridfs(bucket, file_id) -> bytes:
    return bucket.open_download_stream(file_id).read()


def run_parser(parser_id: str, pdf_bytes: bytes) -> tuple[str | None, str | None, float, str | None]:
    with tempfile.TemporaryDirectory(prefix="pdf-work-") as directory:
        pdf_path = os.path.join(directory, "input.pdf")
        with open(pdf_path, "wb") as pdf_file:
            pdf_file.write(pdf_bytes)
        stdout_file = tempfile.TemporaryFile()
        stderr_file = tempfile.TemporaryFile()
        started = time.monotonic()
        process = subprocess.Popen(
            [sys.executable, "-m", "app.parser_child", parser_id, pdf_path],
            stdout=stdout_file,
            stderr=stderr_file,
            start_new_session=True,
            close_fds=True,
            preexec_fn=limit_parser_process,
        )
        timed_out = False
        try:
            process.wait(timeout=settings.work_timeout_seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        elapsed_ms = round((time.monotonic() - started) * 1000, 2)
        stdout_file.seek(0)
        stderr_file.seek(0)
        stdout = stdout_file.read(MAX_CAPTURE_BYTES + 1)
        stderr = stderr_file.read(8192).decode("utf-8", errors="replace")
        stdout_file.close()
        stderr_file.close()
        if timed_out:
            return None, f"Parser exceeded the {settings.work_timeout_seconds}-second work-item timeout.", elapsed_ms, "timeout"
        if len(stdout) > MAX_CAPTURE_BYTES:
            return None, "Parser output exceeded the 32 MiB output limit.", elapsed_ms, "parser_failure"
        if process.returncode != 0:
            if process.returncode in (-signal.SIGKILL, 137):
                return None, "Parser process was killed, likely due to memory pressure.", elapsed_ms, "memory_failure"
            message = None
            for candidate in (stdout, stderr.encode("utf-8")):
                try:
                    message = json.loads(candidate.decode("utf-8")).get("error")
                    if message:
                        break
                except Exception:
                    continue
            if message and "MemoryError" in message:
                return None, message[:500], elapsed_ms, "memory_failure"
            return None, (message or " ".join(stderr.split()) or "Parser failed.")[:500], elapsed_ms, "parser_failure"
        try:
            payload = json.loads(stdout.decode("utf-8"))
            return payload["text"], None, elapsed_ms, None
        except Exception:
            return None, "Parser returned an invalid output payload.", elapsed_ms, "parser_failure"


def char_error_rate(reference: str | None, output: str | None) -> float | None:
    if reference is None or output is None:
        return None
    reference = " ".join(reference.split())
    output = " ".join(output.split())
    if not reference:
        return 0.0 if not output else None
    return levenshtein_distance(reference, output) / len(reference)


def scoring_text(raw: str) -> str:
    lines = raw.splitlines()
    page_start = next((index for index, line in enumerate(lines) if line.startswith("=== PAGE ")), None)
    extracted_start = next((index for index, line in enumerate(lines) if line == "=== EXTRACTED TEXT ==="), None)
    start = page_start if page_start is not None else extracted_start
    if start is not None:
        lines = lines[start:]
    lines = [line for line in lines if not line.startswith("=== PAGE ") and line != "=== EXTRACTED TEXT ==="]
    lines = [line for line in lines if not line.startswith("Note: pdfminer.six") and not line.startswith("For advanced features")]
    return "\n".join(lines)


def reference_text(bucket, item):
    if not item.get("reference_file_id"):
        return None
    raw = read_gridfs(bucket, item["reference_file_id"]).decode("utf-8", errors="replace")
    try:
        payload = json.loads(raw)
        if isinstance(payload, dict) and isinstance(payload.get("pages"), list):
            return "\n".join(page.get("text", "") for page in payload["pages"])
    except json.JSONDecodeError:
        pass
    return raw


def package_version(package_name: str) -> str:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return "unknown"


def next_work(db, job_id):
    item = db.work_items.find_one({"job_id": job_id, "status": "queued"}, sort=[("sequence", 1)])
    if item:
        db.work_items.update_one({"_id": item["_id"], "status": "queued"}, {"$set": {"ready": True, "dispatch_state": "pending", "dispatch_at": utcnow()}})


def publish_report(db, job):
    if job.get("kind") != "corpus":
        return
    revision = db.dataset_revisions.find_one({"dataset_id": job["dataset_id"], "revision": job["dataset_revision"], "status": "published"})
    if not revision:
        return
    results = list(db.results.find({"job_id": job["_id"]}, {"output_file_id": 0}).sort("sequence", 1))
    summary = {}
    for parser_id in job["parser_ids"]:
        rows = [result for result in results if result["parser_id"] == parser_id]
        successful = [row for row in rows if row["status"] == "completed"]
        scored = [row["metrics"]["character_error_rate"] for row in successful if row.get("metrics", {}).get("character_error_rate") is not None]
        summary[parser_id] = {
            "parser_version": next((row["parser_version"] for row in rows if row.get("parser_version")), "unknown"),
            "success_rate": {"value": len(successful) / len(rows) if rows else None, "numerator": len(successful), "denominator": len(rows)},
            "empty_output_rate": {"value": sum(not row.get("output_length", 0) for row in successful) / len(successful) if successful else None, "numerator": sum(not row.get("output_length", 0) for row in successful), "denominator": len(successful)},
            "parse_time_ms": {"value": sum(row["elapsed_ms"] for row in successful) / len(successful) if successful else None, "numerator": len(successful), "denominator": len(successful)},
            "character_error_rate": {"value": sum(scored) / len(scored) if scored else None, "numerator": len(scored), "denominator": len(scored)},
            "failed_items": [{"document_id": row.get("document_id"), "error_type": row.get("error_type"), "error": row.get("error")} for row in rows if row["status"] != "completed"],
        }
    report = {
        "_id": job["_id"],
        "job_id": job["_id"],
        "dataset_id": job["dataset_id"],
        "dataset_revision": job["dataset_revision"],
        "scoring_version": revision.get("scoring_version", "cer-char-v1"),
        "execution_profile": job["execution_profile"],
        "parser_ids": job["parser_ids"],
        "metrics": summary,
        "document_results": [
            {"document_id": row.get("document_id"), "filename": row["filename"], "parser_id": row["parser_id"], "parser_version": row["parser_version"], "status": row["status"], "elapsed_ms": row["elapsed_ms"], "queue_wait_ms": row.get("queue_wait_ms"), "metrics": row.get("metrics", {}), "output_length": row.get("output_length", 0), "error_type": row.get("error_type"), "error": row.get("error")}
            for row in results
        ],
        "published_at": utcnow(),
    }
    db.published_reports.replace_one({"_id": report["_id"]}, report, upsert=True)


def finalize_work(db, bucket, item, attempt_id, *, text=None, error=None, error_type=None, elapsed_ms=0.0, retryable=False):
    output_file_id = None
    if text is not None:
        data = text.encode("utf-8")
        output_file_id = bucket.upload_from_stream(
            f"{item['filename']}.{item['parser_id']}.txt", data,
            metadata={"kind": "parser-output", "job_id": item["job_id"], "work_id": item["_id"], "sha256": hashlib.sha256(data).hexdigest(), "created_at": utcnow()},
        )
    reference = reference_text(bucket, item) if text is not None else None
    cer = char_error_rate(reference, scoring_text(text)) if text is not None else None
    final_status = "completed" if error is None else "failed"
    attempt_filter = {"_id": item["_id"], "status": "running", "attempt_id": attempt_id}
    if retryable and item.get("attempt_count", 0) < 2:
        changed = db.work_items.update_one(attempt_filter, {"$set": {"status": "queued", "ready": True, "dispatch_state": "pending", "dispatch_at": utcnow(), "last_infrastructure_error": error, "lease_expires_at": None}})
        if changed.modified_count:
            return "retry"
    result = {
        "_id": item["_id"], "job_id": item["job_id"], "work_id": item["_id"],
        "sequence": item["sequence"], "document_id": item.get("document_id"),
        "filename": item["filename"], "parser_id": item["parser_id"],
        "parser_version": package_version({"pymupdf": "PyMuPDF", "pdfplumber": "pdfplumber", "pypdf": "pypdf", "pdfminer": "pdfminer.six"}[item["parser_id"]]),
        "configuration": {"ocr_language": settings.ocr_language},
        "elapsed_ms": elapsed_ms,
        "queue_wait_ms": max(0.0, round((item["started_at"] - item["created_at"]).total_seconds() * 1000, 2)) if item.get("started_at") else None,
        "status": final_status, "metrics": {"character_error_rate": cer},
        "output_length": len(text or ""), "output_file_id": output_file_id,
        "error_type": error_type, "error": (" ".join(error.split())[:500] if error else None),
        "reference_file_id": item.get("reference_file_id"), "created_at": utcnow(),
    }
    changed = db.work_items.update_one(
        attempt_filter,
        {"$set": {"status": final_status, "ready": False, "result": result, "completed_at": utcnow(), "lease_expires_at": None}},
    )
    if not changed.modified_count:
        if output_file_id:
            bucket.delete(output_file_id)
        return "stale"
    db.results.replace_one({"_id": result["_id"]}, result, upsert=True)
    job = db.jobs.find_one({"_id": item["job_id"]})
    complete = db.results.count_documents({"job_id": job["_id"]})
    failed = db.results.count_documents({"job_id": job["_id"], "status": "failed"})
    if complete >= job["total_work"]:
        status = "completed_with_errors" if failed else "completed"
        finished_at = utcnow()
        db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": status, "completed_work": complete, "failed_work": failed, "updated_at": finished_at, "finished_at": finished_at, "expires_at": finished_at + timedelta(hours=settings.private_job_retention_hours)}})
        from app.jobs import release_capacity
        release_capacity(db, job)
        publish_report(db, job)
    else:
        db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "running", "completed_work": complete, "failed_work": failed, "updated_at": utcnow()}})
        next_work(db, job["_id"])
    return "committed"


def handle_message(db, bucket, redis_client, stream, message_id, fields):
    work_id = fields.get("work_id")
    item = db.work_items.find_one({"_id": work_id})
    if not item:
        redis_client.xack(stream, GROUP, message_id)
        redis_client.xdel(stream, message_id)
        return
    if item["status"] in ("completed", "failed"):
        if item.get("result"):
            db.results.replace_one({"_id": work_id}, item["result"], upsert=True)
        redis_client.xack(stream, GROUP, message_id)
        redis_client.xdel(stream, message_id)
        return
    attempt_id = uuid.uuid4().hex
    now = utcnow()
    claimed = db.work_items.find_one_and_update(
        {"_id": work_id, "status": "queued", "ready": True},
        {"$set": {"status": "running", "attempt_id": attempt_id, "lease_expires_at": now + timedelta(seconds=settings.work_lease_seconds), "started_at": now}, "$inc": {"attempt_count": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        redis_client.xack(stream, GROUP, message_id)
        redis_client.xdel(stream, message_id)
        return
    db.jobs.update_one({"_id": item["job_id"], "status": "queued"}, {"$set": {"status": "running", "updated_at": now}})
    try:
        pdf_bytes = read_gridfs(bucket, claimed["file_id"])
        text, error, elapsed, error_type = run_parser(claimed["parser_id"], pdf_bytes)
        outcome = finalize_work(db, bucket, claimed, attempt_id, text=text, error=error, error_type=error_type, elapsed_ms=elapsed)
        if outcome == "retry":
            redis_client.xack(stream, GROUP, message_id)
            redis_client.xdel(stream, message_id)
            return
        redis_client.xack(stream, GROUP, message_id)
        redis_client.xdel(stream, message_id)
    except Exception as exc:
        try:
            outcome = finalize_work(db, bucket, claimed, attempt_id, error=f"Temporary worker infrastructure failure: {type(exc).__name__}", error_type="infrastructure_failure", retryable=True)
            if outcome == "retry":
                redis_client.xack(stream, GROUP, message_id)
                redis_client.xdel(stream, message_id)
                return
            redis_client.xack(stream, GROUP, message_id)
            redis_client.xdel(stream, message_id)
        except Exception:
            # Leave the message pending; XAUTOCLAIM will reclaim it after the lease window.
            return


def ensure_groups(redis_client):
    for stream in STREAMS.values():
        try:
            redis_client.xgroup_create(stream, GROUP, id="0", mkstream=True)
        except Exception as exc:
            if "BUSYGROUP" not in str(exc):
                raise


def take_message(redis_client, kind, consumer):
    stream = STREAMS[kind]
    try:
        claimed = redis_client.xautoclaim(stream, GROUP, consumer, settings.work_lease_seconds * 1000, start_id="0-0", count=1)
        messages = claimed[1]
        if messages:
            return stream, messages[0]
    except Exception:
        pass
    response = redis_client.xreadgroup(GROUP, consumer, {stream: ">"}, count=1, block=500)
    if response and response[0][1]:
        return stream, response[0][1][0]
    return None


def main():
    mongo = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    db = mongo.get_default_database()
    ensure_indexes(db)
    seed_parser_catalog(db)
    validate_parser_catalog(db)
    bucket = GridFSBucket(db, bucket_name="artifacts")
    ensure_groups(redis_client)
    consumer = settings.worker_id
    active = {"work_id": None}
    stop = threading.Event()
    thread = threading.Thread(target=heartbeat_loop, args=(db, stop, active), daemon=True)
    thread.start()
    upload_streak = 0
    try:
        while True:
            heartbeat(db, active.get("work_id"))
            preferred = "corpus" if upload_streak >= 5 else "upload"
            message = take_message(redis_client, preferred, consumer)
            if not message:
                message = take_message(redis_client, "upload" if preferred == "corpus" else "corpus", consumer)
            if not message:
                continue
            stream, entry = message
            message_id, fields = entry
            work = db.work_items.find_one({"_id": fields.get("work_id")})
            active["work_id"] = fields.get("work_id")
            handle_message(db, bucket, redis_client, stream, message_id, fields)
            if work and work.get("stream") == "upload":
                upload_streak += 1
            else:
                upload_streak = 0
            active["work_id"] = None
    finally:
        stop.set()
        thread.join(timeout=2)
        mongo.close()
        redis_client.close()


if __name__ == "__main__":
    main()
