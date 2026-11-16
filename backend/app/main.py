from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from gridfs import GridFSBucket
from pymongo import MongoClient
from redis import Redis

from app.config import get_settings
from app.database import ensure_indexes, seed_parser_catalog
from app.registry import validate_parser_catalog
from app.routes import benchmarking, extraction, jobs
from app.jobs import service_is_ready

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo_client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        mongo_client.admin.command("ping")
        redis_client.ping()
        db = mongo_client.get_default_database()
        ensure_indexes(db)
        seed_parser_catalog(db)
        validate_parser_catalog(db)
        app.state.mongo_client = mongo_client
        app.state.db = db
        app.state.bucket = GridFSBucket(db, bucket_name="artifacts")
        app.state.redis_client = redis_client
        yield
    finally:
        mongo_client.close()
        redis_client.close()


app = FastAPI(
    title=settings.app_name,
    description="Mongo-backed PDF parser catalog and durable extraction jobs",
    version="0.2.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(extraction.router, prefix=settings.api_v1_prefix)
app.include_router(benchmarking.router, prefix=settings.api_v1_prefix)
app.include_router(jobs.router, prefix=settings.api_v1_prefix)


@app.get("/")
def root():
    return {"name": settings.app_name, "version": app.version, "docs": "/docs", "parsers": "/api/v1/parsers"}


@app.get("/health")
def health_check(request: Request):
    try:
        request.app.state.mongo_client.admin.command("ping")
        request.app.state.redis_client.ping()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="MongoDB or Redis is unavailable.") from exc
    if not service_is_ready(request.app.state.db):
        raise HTTPException(status_code=503, detail="The dispatcher or worker is unavailable.")
    return {"status": "healthy", "mongodb": "connected", "redis": "connected", "dispatcher": "healthy", "worker": "healthy"}
