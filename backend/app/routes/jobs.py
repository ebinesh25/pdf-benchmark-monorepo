from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from app.database import public_parser
from app.jobs import (
    get_private_job,
    load_result_output,
    paginated_job_results,
    public_job_status,
    submit_corpus_job,
)

router = APIRouter(tags=["Catalog, jobs, and reports"])


class DatasetRunRequest(BaseModel):
    revision: int = Field(ge=1)
    parsers: list[str] = Field(min_length=1, max_length=4)


@router.get("/parsers")
def list_parsers(request: Request):
    return [public_parser(parser) for parser in request.app.state.db.parsers.find({"enabled": True}).sort("name", 1)]


@router.get("/parsers/{parser_id}")
def get_parser(parser_id: str, request: Request):
    parser_id = "pypdf" if parser_id == "pypdf2" else parser_id
    parser = request.app.state.db.parsers.find_one({"_id": parser_id, "enabled": True})
    if not parser:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Parser not found.")
    return public_parser(parser)


@router.get("/datasets")
def list_datasets(request: Request):
    return list(request.app.state.db.dataset_revisions.find(
        {"status": "published"}, {"_id": 0, "dataset_id": 1, "revision": 1, "title": 1, "description": 1, "document_count": 1, "categories": 1, "scoring_version": 1}
    ).sort([("dataset_id", 1), ("revision", -1)]))


@router.get("/datasets/{dataset_id}/revisions/{revision}/documents")
def list_dataset_documents(dataset_id: str, revision: int, request: Request):
    db = request.app.state.db
    if not db.dataset_revisions.find_one({"dataset_id": dataset_id, "revision": revision, "status": "published"}):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Published dataset revision not found.")
    return list(db.dataset_documents.find(
        {"dataset_id": dataset_id, "revision": revision},
        {"_id": 1, "filename": 1, "category": 1, "tags": 1, "source": 1, "license": 1, "sha256": 1, "page_count": 1, "annotation_coverage": 1},
    ).sort("sequence", 1))


@router.get("/datasets/{dataset_id}/revisions/{revision}/documents/{document_id}/pdf")
def get_dataset_pdf(dataset_id: str, revision: int, document_id: str, request: Request):
    db = request.app.state.db
    document = db.dataset_documents.find_one({"_id": document_id, "dataset_id": dataset_id, "revision": revision})
    if not document or not db.dataset_revisions.find_one({"dataset_id": dataset_id, "revision": revision, "status": "published"}):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Published corpus document not found.")
    content = request.app.state.bucket.open_download_stream(document["pdf_file_id"]).read()
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{Path(document["filename"]).name}"'})


@router.post("/datasets/{dataset_id}/runs", status_code=202)
async def run_dataset(dataset_id: str, payload: DatasetRunRequest, request: Request):
    receipt = await submit_corpus_job(request, dataset_id, payload.revision, payload.parsers)
    return JSONResponse(receipt, status_code=202)


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request, offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100)):
    job = get_private_job(request, job_id)
    return paginated_job_results(request, job, offset, limit)


@router.get("/jobs/{job_id}/results/{result_id}/output")
def get_result_output(job_id: str, result_id: str, request: Request):
    job = get_private_job(request, job_id)
    output, filename = load_result_output(request, job, result_id)
    safe_filename = Path(filename).name.replace('"', "")
    return PlainTextResponse(output, headers={"Content-Disposition": f'inline; filename="{safe_filename}"'})


@router.get("/jobs/{job_id}/documents/{document_id}/pdf")
def get_private_job_pdf(job_id: str, document_id: str, request: Request):
    job = get_private_job(request, job_id)
    work_item = request.app.state.db.work_items.find_one({"job_id": job["_id"], "document_id": document_id})
    file_id = work_item["file_id"] if work_item else job.get("source_file_id")
    if not file_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="PDF artifact not found.")
    content = request.app.state.bucket.open_download_stream(file_id).read()
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": "inline"})


@router.get("/reports")
def list_reports(request: Request):
    reports = request.app.state.db.published_reports.find({}, {"_id": 0}).sort("published_at", -1).limit(100)
    rows = list(reports)
    for report in rows:
        report["comparable_group"] = "|".join([
            report["dataset_id"], str(report["dataset_revision"]), report["scoring_version"],
            str(sorted(report["execution_profile"].items())),
        ])
    return rows


@router.get("/reports/{report_id}")
def get_report(report_id: str, request: Request):
    report = request.app.state.db.published_reports.find_one({"_id": report_id}, {"_id": 0})
    if not report:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Published report not found.")
    return report


@router.get("/reports/{report_id}/documents/{document_id}/results/{parser_id}/output")
def get_public_report_output(report_id: str, document_id: str, parser_id: str, request: Request):
    db = request.app.state.db
    report = db.published_reports.find_one({"_id": report_id})
    if not report or not db.dataset_revisions.find_one({"dataset_id": report["dataset_id"], "revision": report["dataset_revision"], "status": "published"}):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Published report not found.")
    result = db.results.find_one({"job_id": report_id, "document_id": document_id, "parser_id": parser_id, "status": "completed"})
    if not result or not result.get("output_file_id"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Published parser output not found.")
    content = request.app.state.bucket.open_download_stream(result["output_file_id"]).read().decode("utf-8", errors="replace")
    return PlainTextResponse(content)
