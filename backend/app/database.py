from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version

from gridfs import GridFSBucket
from pymongo import ASCENDING, MongoClient


PARSER_SEEDS = [
    {
        "_id": "pymupdf",
        "name": "PyMuPDF",
        "description": "Fast PDF text, metadata, image, and layout extraction.",
        "category": "Open Source",
        "features": ["Text extraction", "Metadata", "OCR on embedded images"],
        "package": "PyMuPDF",
        "enabled": True,
    },
    {
        "_id": "pdfplumber",
        "name": "pdfplumber",
        "description": "Detailed PDF text and table extraction with layout information.",
        "category": "Open Source",
        "features": ["Table extraction", "Layout analysis", "Character-level data"],
        "package": "pdfplumber",
        "enabled": True,
    },
    {
        "_id": "pypdf",
        "name": "pypdf",
        "description": "Lightweight Python library for PDF text and metadata extraction.",
        "category": "Open Source",
        "features": ["Text extraction", "Metadata", "Page operations"],
        "package": "pypdf",
        "enabled": True,
    },
    {
        "_id": "pdfminer",
        "name": "PDFMiner.six",
        "description": "PDF text extraction with layout analysis and positional information.",
        "category": "Open Source",
        "features": ["Layout analysis", "Text positioning", "Character-level parsing"],
        "package": "pdfminer.six",
        "enabled": True,
    },
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_indexes(db) -> None:
    db.parsers.create_index([("enabled", ASCENDING), ("name", ASCENDING)])
    db.dataset_revisions.create_index([("dataset_id", ASCENDING), ("revision", ASCENDING)], unique=True)
    db.dataset_documents.create_index([("dataset_id", ASCENDING), ("revision", ASCENDING), ("category", ASCENDING)])
    # A cleanup loop must remove GridFS artifacts before deleting expired job documents.
    db.jobs.create_index([("expires_at", ASCENDING)])
    db.jobs.create_index([("status", ASCENDING), ("created_at", ASCENDING)])
    db.jobs.create_index([("kind", ASCENDING), ("status", ASCENDING)])
    db.work_items.create_index([("job_id", ASCENDING), ("sequence", ASCENDING)], unique=True)
    db.work_items.create_index([("status", ASCENDING), ("ready", ASCENDING), ("dispatch_at", ASCENDING)])
    db.work_items.create_index([("status", ASCENDING), ("lease_expires_at", ASCENDING)])
    db.results.create_index([("job_id", ASCENDING), ("sequence", ASCENDING)])
    db.results.create_index([("job_id", ASCENDING), ("work_id", ASCENDING)], unique=True)
    db.service_heartbeats.create_index([("updated_at", ASCENDING)])
    db.published_reports.create_index([("published_at", ASCENDING)])


def seed_parser_catalog(db) -> None:
    for parser in PARSER_SEEDS:
        db.parsers.update_one(
            {"_id": parser["_id"]},
            {"$setOnInsert": {**parser, "created_at": utcnow(), "updated_at": utcnow()}},
            upsert=True,
        )


def public_parser(parser: dict) -> dict:
    parser_id = parser.get("_id") or parser.get("id")
    parser = {key: value for key, value in parser.items() if key != "_id"}
    parser["id"] = parser_id
    # Canonical IDs are the only identifiers exposed to new clients.
    if parser.get("id") == "pypdf2":
        parser["id"] = "pypdf"
    try:
        parser["installed_version"] = version(parser["package"])
    except (KeyError, PackageNotFoundError):
        parser["installed_version"] = "unknown"
    return parser


def get_bucket(db) -> GridFSBucket:
    return GridFSBucket(db, bucket_name="artifacts")
