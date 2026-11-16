# PDF Tool Benchmark

Monorepo for the PDF extraction benchmark application.

## Run the application

Start the entire stack from the repository root:

```bash
docker compose up --build
```

Copy `.env.example` to `.env` to override upload, queue, and retention limits.

- Frontend: <http://localhost:3001>
- FastAPI and API docs: <http://localhost:8000/docs>
- MongoDB and Redis: internal to the Compose network

Compose starts a one-time corpus importer, FastAPI, a MongoDB-backed dispatcher, Redis Streams, and a single parser worker. Uploaded PDFs and outputs are stored in MongoDB GridFS. The worker has a one CPU / 1 GiB limit and runs one parser subprocess at a time.

The MongoDB catalog powers parser cards and detail pages. Upload comparisons, single extractions, and published corpus runs return private job links. Public benchmark reports use published corpus revisions only.

Persisted MongoDB and Redis data use named volumes. Stop the stack with `Ctrl+C` or `docker compose down`; `docker compose down -v` removes persisted data.

See [backend/README.md](backend/README.md) for API paths, job access, limits, and manual smoke verification.
