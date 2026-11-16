import hashlib
import secrets
import uuid
from datetime import timedelta
from pathlib import Path

import pymupdf as fitz
from fastapi import HTTPException, Request, UploadFile
from gridfs.errors import NoFile
from pymongo import ReturnDocument

from app.config import get_settings
from app.database import get_bucket, utcnow

settings = get_settings()
ACTIVE_STATUSES = ["queued", "running"]


def ensure_capacity_document(db) -> None:
    db.capacity.update_one(
        {"_id": "active"},
        {"$setOnInsert": {"active_uploads": 0, "active_corpus_runs": 0, "active_by_ip": {}}},
        upsert=True,
    )


def service_is_ready(db) -> bool:
    now = utcnow()
    dispatcher = db.service_heartbeats.find_one({"_id": "dispatcher"})
    worker = db.service_heartbeats.find_one({"_id": "worker"})
    return bool(
        dispatcher and worker
        and dispatcher["updated_at"] > now - timedelta(seconds=settings.dispatcher_heartbeat_seconds * 3)
        and worker["updated_at"] > now - timedelta(seconds=settings.worker_heartbeat_seconds * 3)
    )


def reserve_upload_capacity(db, ip_hash: str) -> bool:
    ensure_capacity_document(db)
    field = f"active_by_ip.{ip_hash}"
    return db.capacity.update_one(
        {
            "_id": "active",
            "active_uploads": {"$lt": settings.max_active_upload_jobs},
            "$or": [{field: {"$lt": settings.max_active_upload_jobs_per_ip}}, {field: {"$exists": False}}],
        },
        {"$inc": {"active_uploads": 1, field: 1}},
    ).modified_count == 1


def reserve_corpus_capacity(db) -> bool:
    ensure_capacity_document(db)
    return db.capacity.update_one(
        {"_id": "active", "active_corpus_runs": {"$lt": settings.max_active_corpus_runs}},
        {"$inc": {"active_corpus_runs": 1}},
    ).modified_count == 1


def release_capacity(db, job: dict) -> None:
    if not job.get("capacity_slot"):
        return
    updated = db.jobs.find_one_and_update(
        {"_id": job["_id"], "capacity_released": {"$ne": True}},
        {"$set": {"capacity_released": True}},
        return_document=ReturnDocument.BEFORE,
    )
    if not updated:
        return
    if updated["capacity_slot"] == "upload":
        ip_hash = updated["ip_hash"]
        db.capacity.update_one(
            {"_id": "active"},
            [{"$set": {
                "active_uploads": {"$max": [0, {"$subtract": ["$active_uploads", 1]}]},
                "active_by_ip": {"$let": {
                    "vars": {"reduced": {"$mergeObjects": [
                        "$active_by_ip",
                        {ip_hash: {"$max": [0, {"$subtract": [{"$ifNull": [f"$active_by_ip.{ip_hash}", 0]}, 1]}]}},
                    ]}},
                    "in": {"$arrayToObject": {"$filter": {
                        "input": {"$objectToArray": "$$reduced"},
                        "as": "entry",
                        "cond": {"$gt": ["$$entry.v", 0]},
                    }}},
                }},
            }}],
        )
    elif updated["capacity_slot"] == "corpus":
        db.capacity.update_one({"_id": "active"}, {"$inc": {"active_corpus_runs": -1}})


def check_backend_ready(db, redis_client) -> None:
    try:
        redis_client.ping()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The job queue is unavailable.") from exc
    try:
        ready = service_is_ready(db)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The job services are unavailable.") from exc
    if not ready:
        raise HTTPException(status_code=503, detail="The dispatcher or worker is unavailable.")


def parse_private_token(request: Request, job: dict) -> None:
    if job.get("expires_at") and job["expires_at"] <= utcnow():
        raise HTTPException(status_code=410, detail="This private result has expired.")
    auth = request.headers.get("authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not token or not secrets.compare_digest(
        hashlib.sha256(token.encode()).hexdigest(), job.get("access_token_hash", "")
    ):
        raise HTTPException(status_code=404, detail="Job not found.")


def create_job(db, *, kind: str, parser_ids: list[str], filename: str, file_size: int,
               ip_hash: str, capacity_slot: str, source_file_id=None, dataset_id=None,
               dataset_revision=None, dataset_documents=None, reference_file_id=None) -> tuple[dict, str]:
    job_id = uuid.uuid4().hex
    token = secrets.token_urlsafe(32)
    now = utcnow()
    work_specs = []
    if dataset_documents:
        sequence = 0
        for document in dataset_documents:
            for parser_id in parser_ids:
                work_specs.append({
                    "sequence": sequence,
                    "document_id": document["_id"],
                    "file_id": document["pdf_file_id"],
                    "filename": document["filename"],
                    "reference_file_id": document.get("reference_file_id"),
                    "parser_id": parser_id,
                })
                sequence += 1
    else:
        for sequence, parser_id in enumerate(parser_ids):
            work_specs.append({"sequence": sequence, "file_id": source_file_id, "filename": filename, "parser_id": parser_id, "reference_file_id": reference_file_id})

    total = len(work_specs)
    job = {
        "_id": job_id,
        "kind": kind,
        "status": "queued",
        "filename": filename,
        "file_size_bytes": file_size,
        "parser_ids": parser_ids,
        "total_work": total,
        "completed_work": 0,
        "failed_work": 0,
        "created_at": now,
        "updated_at": now,
        "expires_at": None,
        "access_token_hash": hashlib.sha256(token.encode()).hexdigest(),
        "ip_hash": ip_hash,
        "capacity_slot": capacity_slot,
        "capacity_released": False,
        "source_file_id": source_file_id,
        "dataset_id": dataset_id,
        "dataset_revision": dataset_revision,
        "execution_profile": {"worker_replicas": 1, "max_parallel_parsers": 1, "timeout_seconds": settings.work_timeout_seconds},
    }
    try:
        db.jobs.insert_one(job)
        db.work_items.insert_many([
            {
                "_id": uuid.uuid4().hex,
                "job_id": job_id,
                **spec,
                "stream": "upload" if kind != "corpus" else "corpus",
                "status": "queued",
                "ready": sequence == 0,
                "dispatch_at": now,
                "dispatch_state": "pending",
                "attempt_count": 0,
                "sequence": sequence,
                "created_at": now,
            }
            for sequence, spec in enumerate(work_specs)
        ])
    except Exception:
        db.jobs.delete_one({"_id": job_id})
        db.work_items.delete_many({"job_id": job_id})
        raise
    return job, token


async def validate_upload(file: UploadFile) -> tuple[bytes, int, str]:
    if not file.filename or Path(file.filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Upload a PDF file.")
    content = await file.read(settings.max_file_size + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    if len(content) > settings.max_file_size:
        raise HTTPException(status_code=413, detail="PDF exceeds the 10 MiB upload limit.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The file is not a valid PDF.")
    try:
        document = fitz.open(stream=content, filetype="pdf")
        if document.needs_pass:
            document.close()
            raise HTTPException(status_code=400, detail="Password-protected PDFs are not supported.")
        pages = len(document)
        document.close()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The PDF is malformed or cannot be opened.") from exc
    if pages < 1:
        raise HTTPException(status_code=400, detail="The PDF contains no pages.")
    if pages > settings.max_pdf_pages:
        raise HTTPException(status_code=413, detail=f"PDF exceeds the {settings.max_pdf_pages}-page limit.")
    return content, pages, hashlib.sha256(content).hexdigest()


def store_upload(db, content: bytes, *, filename: str, pages: int, sha256: str):
    return get_bucket(db).upload_from_stream(
        filename,
        content,
        metadata={"kind": "upload", "page_count": pages, "sha256": sha256, "created_at": utcnow()},
    )


async def submit_upload_job(request: Request, file: UploadFile, parser_ids: list[str], kind: str, reference_text: str | None = None) -> dict:
    db = request.app.state.db
    check_backend_ready(db, request.app.state.redis_client)
    supported = {parser["_id"] for parser in db.parsers.find({"enabled": True})}
    if not parser_ids or any(parser_id not in supported for parser_id in parser_ids):
        raise HTTPException(status_code=400, detail="Select one or more enabled parsers.")
    content, pages, sha256 = await validate_upload(file)
    if reference_text is not None and not reference_text.strip():
        reference_text = None
    if reference_text is not None and len(reference_text) > 2_000_000:
        raise HTTPException(status_code=413, detail="Reference text exceeds the 2 MiB limit.")
    storage_doc = next(db.artifacts.files.aggregate([{"$group": {"_id": None, "size": {"$sum": "$length"}}}]), {"size": 0})
    if storage_doc.get("size", 0) + len(content) > settings.queue_max_bytes:
        raise HTTPException(status_code=429, detail="Artifact storage is at capacity. Try again later.", headers={"Retry-After": "60"})
    ip_address = request.headers.get("x-client-ip") or (request.client.host if request.client else "unknown")
    ip_hash = hashlib.sha256(ip_address.encode()).hexdigest()
    if not reserve_upload_capacity(db, ip_hash):
        raise HTTPException(status_code=429, detail="Upload capacity is full. Try again shortly.", headers={"Retry-After": "30"})
    file_id = None
    reference_file_id = None
    job = None
    try:
        filename = Path(file.filename).name
        file_id = store_upload(db, content, filename=filename, pages=pages, sha256=sha256)
        if reference_text is not None:
            reference_bytes = reference_text.encode("utf-8")
            reference_file_id = get_bucket(db).upload_from_stream(
                f"{filename}.reference.txt", reference_bytes,
                metadata={"kind": "reference", "sha256": hashlib.sha256(reference_bytes).hexdigest(), "created_at": utcnow()},
            )
        job, token = create_job(
            db, kind=kind, parser_ids=parser_ids, filename=filename, file_size=len(content),
            ip_hash=ip_hash, capacity_slot="upload", source_file_id=file_id, reference_file_id=reference_file_id,
        )
    except Exception:
        if file_id:
            try:
                get_bucket(db).delete(file_id)
            except Exception:
                pass
        if reference_file_id:
            try:
                get_bucket(db).delete(reference_file_id)
            except Exception:
                pass
        if job:
            release_capacity(db, job)
        else:
            db.capacity.update_one(
                {"_id": "active"},
                {"$inc": {"active_uploads": -1, f"active_by_ip.{ip_hash}": -1}},
            )
        raise
    return job_receipt(job, token)


def job_receipt(job: dict, token: str) -> dict:
    return {
        "job_id": job["_id"],
        "status": job["status"],
        "completed_work": 0,
        "total_work": job["total_work"],
        "result_url": f"/jobs/{job['_id']}#{token}",
    }


async def submit_corpus_job(request: Request, dataset_id: str, revision: int, parser_ids: list[str]) -> dict:
    db = request.app.state.db
    check_backend_ready(db, request.app.state.redis_client)
    supported = {parser["_id"] for parser in db.parsers.find({"enabled": True})}
    if not parser_ids or any(parser_id not in supported for parser_id in parser_ids):
        raise HTTPException(status_code=400, detail="Select one or more enabled parsers.")
    if not reserve_corpus_capacity(db):
        raise HTTPException(status_code=429, detail="A corpus run is already active.", headers={"Retry-After": "30"})
    revision_doc = db.dataset_revisions.find_one({"dataset_id": dataset_id, "revision": revision, "status": "published"})
    if not revision_doc:
        db.capacity.update_one({"_id": "active"}, {"$inc": {"active_corpus_runs": -1}})
        raise HTTPException(status_code=404, detail="Published dataset revision not found.")
    documents = list(db.dataset_documents.find({"dataset_id": dataset_id, "revision": revision}).sort("sequence", 1))
    if not documents:
        db.capacity.update_one({"_id": "active"}, {"$inc": {"active_corpus_runs": -1}})
        raise HTTPException(status_code=409, detail="Dataset revision has no documents.")
    try:
        job, token = create_job(
            db, kind="corpus", parser_ids=parser_ids, filename=f"{dataset_id} r{revision}", file_size=0,
            ip_hash="", capacity_slot="corpus", dataset_id=dataset_id,
            dataset_revision=revision, dataset_documents=documents,
        )
    except Exception:
        db.capacity.update_one({"_id": "active"}, {"$inc": {"active_corpus_runs": -1}})
        raise
    return job_receipt(job, token)


def get_private_job(request: Request, job_id: str) -> dict:
    job = request.app.state.db.jobs.find_one({"_id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    parse_private_token(request, job)
    return job


def public_job_status(job: dict) -> dict:
    return {
        "job_id": job["_id"],
        "kind": job["kind"],
        "status": job["status"],
        "completed_work": job["completed_work"],
        "total_work": job["total_work"],
        "failed_work": job["failed_work"],
        "filename": job["filename"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "dataset_id": job.get("dataset_id"),
        "dataset_revision": job.get("dataset_revision"),
    }


def paginated_job_results(request: Request, job: dict, offset: int, limit: int) -> dict:
    db = request.app.state.db
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    results = list(
        db.results.find({"job_id": job["_id"]}, {"output_file_id": 0})
        .sort("sequence", 1).skip(offset).limit(limit)
    )
    for result in results:
        result["id"] = str(result.pop("_id"))
        result.pop("job_id", None)
        result["full_output_url"] = f"/api/v1/jobs/{job['_id']}/results/{result['id']}/output"
        if result.get("reference_file_id"):
            result.pop("reference_file_id", None)
    return {**public_job_status(job), "offset": offset, "limit": limit, "results": results}


def load_result_output(request: Request, job: dict, result_id: str) -> tuple[str, str]:
    db = request.app.state.db
    result = db.results.find_one({"_id": result_id, "job_id": job["_id"]})
    if not result or not result.get("output_file_id"):
        raise HTTPException(status_code=404, detail="Parser output not found.")
    try:
        stream = get_bucket(db).open_download_stream(result["output_file_id"])
        return stream.read().decode("utf-8", errors="replace"), result.get("filename", "output.txt")
    except NoFile as exc:
        raise HTTPException(status_code=404, detail="Parser output not found.") from exc
