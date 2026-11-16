from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App settings
    app_name: str = "PDF Extraction Backend"
    debug: bool = False

    # File upload settings
    max_file_size: int = 10 * 1024 * 1024  # 10MB
    allowed_extensions: set[str] = {".pdf"}
    upload_dir: str = "temp_uploads"

    # OCR settings
    tesseract_cmd: str | None = None  # Path to tesseract executable (None = auto-detect)
    ocr_language: str = "eng"  # Default OCR language

    # API settings
    api_v1_prefix: str = "/api/v1"

    # Data services
    mongodb_uri: str = "mongodb://localhost:27017/pdf_benchmark"
    redis_url: str = "redis://localhost:6379/0"

    # Queueing, capacity, and retention
    max_pdf_pages: int = 100
    max_active_upload_jobs: int = 20
    max_active_upload_jobs_per_ip: int = 2
    max_active_corpus_runs: int = 1
    private_job_retention_hours: int = 24
    worker_heartbeat_seconds: int = 30
    dispatcher_heartbeat_seconds: int = 15
    work_lease_seconds: int = 120
    work_timeout_seconds: int = 90
    queue_max_bytes: int = 1024 * 1024 * 1024
    worker_id: str = "worker-1"

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
