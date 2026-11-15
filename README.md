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

The backend API docs are available at <http://localhost:8000/docs>. Configure the frontend API URL using its environment configuration if needed.
