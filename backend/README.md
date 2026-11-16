# PDF extraction backend

FastAPI accepts extraction, comparison, and corpus-run submissions. It stores private job state and PDF artifacts in MongoDB/GridFS. A dispatcher sends work IDs to Redis Streams, and a separate worker runs one parser subprocess at a time.

## Run the full application

Use the repository root Compose file so the API, catalog seeder, dispatcher, worker, MongoDB, Redis, and Next.js frontend start together:

```bash
cd ..
docker compose up --build
```

The frontend is available at <http://localhost:3001>, API docs at <http://localhost:8000/docs>, and MongoDB/Redis stay on the internal Compose network. The starter corpus is generated and imported idempotently at startup. MongoDB and Redis data use named volumes.

## API

- `GET /api/v1/parsers` and `GET /api/v1/parsers/{id}` read the MongoDB parser catalog.
- `POST /api/v1/extract/{parser_id}` accepts a PDF and returns `202` with a job receipt.
- `POST /api/v1/benchmark?tools=pymupdf&tools=pypdf` accepts a PDF comparison and returns `202`.
- `GET /api/v1/datasets` lists published corpus revisions.
- `POST /api/v1/datasets/{dataset_id}/runs` queues a run for a published revision.
- `GET /api/v1/jobs/{job_id}` returns private progress and paginated parser results.
- `GET /api/v1/jobs/{job_id}/results/{result_id}/output` returns full parser output.
- `GET /api/v1/reports` and `/api/v1/reports/{id}` serve public reports generated only from published corpus revisions.

Job receipts include a private result URL with its access token in the URL fragment. The browser sends that token as a Bearer authorization header. Private job records and their artifacts expire 24 hours after completion; published corpus artifacts and reports are retained.

## Manual smoke verification

With root Compose running, execute:

```bash
cd backend
uv run python verify_benchmark.py
```

The script submits a two-parser comparison, polls the private job endpoint, and prints each parser's final status and elapsed time.

## Runtime limits

Defaults are configurable with root `.env` (copy `.env.example`) for Compose or `backend/.env` for a local API process: 10 MiB per PDF, 100 pages, 20 active uploads globally, two per client IP, one active corpus run, one worker replica, and a 90-second parser subprocess timeout. The worker Compose service is limited to one CPU and 1 GiB RAM.
