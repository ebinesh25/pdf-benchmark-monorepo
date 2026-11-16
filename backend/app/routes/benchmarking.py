from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from app.jobs import submit_upload_job

router = APIRouter(prefix="/benchmark", tags=["Comparison jobs"])


@router.post("", status_code=202, summary="Queue a PDF comparison")
async def benchmark_pdf(
    request: Request,
    file: UploadFile = File(...),
    tools: list[str] = Query(..., description="Canonical parser IDs"),
    ground_truth: str | None = Form(None),
):
    """Accept a comparison job; parser work runs in the isolated worker."""
    tools = ["pypdf" if tool == "pypdf2" else tool for tool in tools]
    receipt = await submit_upload_job(request, file, tools, "comparison", ground_truth)
    return JSONResponse(receipt, status_code=202)
