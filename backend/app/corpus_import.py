"""Generate and import the deterministic synthetic starter benchmark corpus."""

import hashlib
import io
import json

from gridfs import GridFSBucket
from PIL import Image, ImageDraw, ImageFont
from pymongo import MongoClient
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle

from app.config import get_settings
from app.database import ensure_indexes, seed_parser_catalog, utcnow
from app.registry import validate_parser_catalog

settings = get_settings()
DATASET_ID = "starter-corpus"
REVISION = 1
LICENSE = "CC0-1.0"
CATEGORIES = ["clean-text", "scans", "columns", "tables", "forms"]


def fixture_content(category: str, number: int) -> tuple[bytes, str]:
    label = f"Fixture {category} {number:02d}"
    lines = [
        label,
        f"Reference ID: PDF-BENCH-{category.upper()}-{number:02d}",
        f"This synthetic {category.replace('-', ' ')} document is generated for parser evaluation.",
        f"The reproducible record number is {number}.",
        "Expected extraction text is stored as a page-level reference annotation.",
    ]
    reference = "\n".join(lines)
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter, invariant=1)
    pdf.setTitle(label)
    pdf.setAuthor("PDF Benchmark synthetic corpus")
    if category == "scans":
        image = Image.new("RGB", (1240, 1600), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=34)
        y = 150
        for line in lines:
            draw.text((110, y), line, fill="black", font=font)
            y += 110
        img_buffer = io.BytesIO()
        image.save(img_buffer, format="PNG", optimize=False)
        pdf.drawImage(ImageReader(io.BytesIO(img_buffer.getvalue())), 0, 0, width=letter[0], height=letter[1])
    elif category == "columns":
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(60, 730, label)
        pdf.setFont("Helvetica", 11)
        left = lines[1:3]
        right = lines[3:]
        for index, text in enumerate(left):
            pdf.drawString(60, 680 - index * 30, text)
        for index, text in enumerate(right):
            pdf.drawString(320, 680 - index * 30, text)
    elif category == "tables":
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(60, 730, label)
        table = Table([["Field", "Value"], ["Reference ID", f"PDF-BENCH-{category.upper()}-{number:02d}"], ["Record", str(number)], ["Type", "Synthetic evaluation"]], colWidths=[150, 280])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("PADDING", (0, 0), (-1, -1), 8),
        ]))
        table.wrapOn(pdf, 500, 500)
        table.drawOn(pdf, 60, 600)
    elif category == "forms":
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(60, 730, label)
        y = 670
        for key, value in [("Reference ID", f"PDF-BEN-{category.upper()}-{number:02d}"), ("Record", str(number)), ("Document type", "Synthetic evaluation"), ("Review status", "Complete")]:
            pdf.setFont("Helvetica-Bold", 11)
            pdf.drawString(60, y, key + ":")
            pdf.setFont("Helvetica", 11)
            pdf.rect(190, y - 5, 300, 24)
            pdf.drawString(200, y + 3, value)
            y -= 58
    else:
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(60, 730, label)
        pdf.setFont("Helvetica", 11)
        for index, line in enumerate(lines[1:]):
            pdf.drawString(60, 680 - index * 30, line)
    pdf.save()
    return buffer.getvalue(), reference


def import_corpus(db):
    bucket = GridFSBucket(db, bucket_name="artifacts")
    revision = db.dataset_revisions.find_one({"dataset_id": DATASET_ID, "revision": REVISION})
    if revision and revision.get("status") == "published":
        return {"status": "already_published", "documents": revision.get("document_count", 0)}
    if revision:
        for previous in db.dataset_documents.find({"dataset_id": DATASET_ID, "revision": REVISION}):
            for field in ("pdf_file_id", "reference_file_id"):
                if previous.get(field):
                    try:
                        bucket.delete(previous[field])
                    except Exception:
                        pass
        db.dataset_documents.delete_many({"dataset_id": DATASET_ID, "revision": REVISION})
    now = utcnow()
    db.dataset_revisions.update_one(
        {"dataset_id": DATASET_ID, "revision": REVISION},
        {"$set": {"title": "Synthetic PDF extraction corpus", "description": "Twenty reproducible one-page fixtures for clean text, scans, columns, tables, and forms.", "status": "staging", "scoring_version": "cer-char-v1", "created_at": now}},
        upsert=True,
    )
    sequence = 0
    for category in CATEGORIES:
        for number in range(1, 5):
            filename = f"{category}-{number:02d}.pdf"
            pdf_bytes, reference = fixture_content(category, number)
            pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()
            annotation = json.dumps({"version": "reference-text-v1", "coverage": "full-page-text", "pages": [{"page": 1, "text": reference}]}, ensure_ascii=False).encode()
            pdf_id = bucket.upload_from_stream(filename, pdf_bytes, metadata={"kind": "corpus-pdf", "dataset_id": DATASET_ID, "revision": REVISION, "sha256": pdf_sha, "created_at": now})
            annotation_id = bucket.upload_from_stream(f"{filename}.annotations.json", annotation, metadata={"kind": "reference-annotation", "dataset_id": DATASET_ID, "revision": REVISION, "sha256": hashlib.sha256(annotation).hexdigest(), "created_at": now})
            db.dataset_documents.insert_one({
                "_id": f"{DATASET_ID}-r{REVISION}-{category}-{number:02d}",
                "dataset_id": DATASET_ID,
                "revision": REVISION,
                "sequence": sequence,
                "filename": filename,
                "category": category,
                "tags": [category, "synthetic", "one-page"],
                "source": "Deterministically generated by backend/app/corpus_import.py",
                "license": LICENSE,
                "sha256": pdf_sha,
                "page_count": 1,
                "annotation_coverage": 1.0,
                "pdf_file_id": pdf_id,
                "reference_file_id": annotation_id,
                "annotation_sha256": hashlib.sha256(annotation).hexdigest(),
            })
            sequence += 1
    db.dataset_revisions.update_one(
        {"dataset_id": DATASET_ID, "revision": REVISION},
        {"$set": {"status": "published", "published_at": utcnow(), "document_count": sequence, "categories": CATEGORIES, "source": "Synthetic fixtures generated by project importer", "license": LICENSE}},
    )
    return {"status": "published", "documents": sequence}


def main():
    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
    db = client.get_default_database()
    ensure_indexes(db)
    seed_parser_catalog(db)
    validate_parser_catalog(db)
    print(json.dumps(import_corpus(db)))
    client.close()


if __name__ == "__main__":
    main()
