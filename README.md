# PDF Tool Benchmark

Monorepo for the PDF extraction benchmark application.

## Projects

- `backend/` — FastAPI PDF extraction and benchmarking API.
- `frontend/` — Next.js web application.

## Local development

Start the backend in one terminal:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Start the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

The backend API docs are available at <http://localhost:8000/docs>. The frontend sends PDF benchmark requests through its Next.js API route; Docker Compose connects that route to the backend service.

## Run both apps with Docker

From the repository root, build and start both services:

```bash
docker compose up --build
```

- Frontend: <http://localhost:3001>
- Backend API: <http://localhost:8000>
- API docs: <http://localhost:8000/docs>

Stop the services with `Ctrl+C`, or run `docker compose down` in another terminal.
