from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from app.jobs import submit_upload_job

router = APIRouter(prefix="/extract", tags=["PDF extraction jobs"])


@router.post("/{parser_id}", status_code=202, summary="Queue PDF extraction")
async def extract_pdf(parser_id: str, request: Request, file: UploadFile = File(...)):
    """Accept an extraction job; parsing runs in the isolated worker."""
    parser_id = "pypdf" if parser_id == "pypdf2" else parser_id
    receipt = await submit_upload_job(request, file, [parser_id], "extraction")
    return JSONResponse(receipt, status_code=202)
