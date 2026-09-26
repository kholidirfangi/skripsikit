@echo off
start cmd /k "cd backend && venv\Scripts\activate && uvicorn api:app --reload --port 8000"
start cmd /k "cd frontend && npm run dev"