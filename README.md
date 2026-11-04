# LUMETRA CLASSORA — Your classroom. Your AI. Your way.
AI teachers **AIRA** (female) and **NEX** (male). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run (Windows)
```
cd backend
python -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env        # set JWT_SECRET; optionally an LLM key
.venv\Scripts\python -m uvicorn app.main:app --port 8000

cd frontend
npm install
node node_modules/vite/bin/vite.js      # http://localhost:5173  (use this form if your path contains '&')
```
Tests: `cd backend && .venv\Scripts\python -m pytest -q`. Use **Chrome or Edge** for voice features.

## Configuration (env vars, never hardcoded)
| Variable | Purpose | Cost |
|---|---|---|
| `LLM_PROVIDER` = `anthropic` / `openai` + key | Real teaching for any topic. `openai` works with any compatible endpoint (Groq, Ollama, Gemini-compat) | Paid (Ollama: free) |
| `DATABASE_URL` | SQLite default; PostgreSQL supported | Free |
| `GOOGLE_CLIENT_ID` (+ `VITE_GOOGLE_CLIENT_ID` in frontend) | Google sign-in | Free |
| `SMTP_*` | Verification / reset emails (otherwise links are logged to the server console) | Varies |

## What works vs. what doesn't (honest status)
**Working & tested:** auth (hashed passwords, JWT, reset/verify tokens, rate limits), per-user isolation, PDF/DOCX/PPTX/TXT parsing + roadmap, TF-IDF retrieval, Hinglish intent parsing, structured board actions validated server-side, quizzes with server-side grading, notes/flashcards, progress/streak/weak topics, style-profile analysis, themes, 5 backend tests.
**Built, needs your browser check (no automated UI test run):** classroom UI, SVG board (pen/eraser/undo/pages/PNG/PDF-print), avatar animation, TTS, push-to-talk, wake word.
**Limitations:** without an LLM key only 4 built-in demo topics + document read-through; left panel shows extracted text, not the original PDF render; lip-sync is approximate (word-timing); wake word needs Chrome/Edge + internet; "go back 10 seconds" = previous teaching step; OCR needs Tesseract; legacy `.ppt` unsupported; realistic/3D avatars, voice cloning, neural Indian voices are not implemented.
