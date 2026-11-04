# LUMETRA CLASSORA — Architecture & Roadmap

*Your classroom. Your AI. Your way.* Teachers: **AIRA** (female) and **NEX** (male).

## 1. System overview

```
Browser (React + TS + Tailwind + Framer Motion)
 ├─ Web Speech API  → STT, TTS, wake-word (continuous recognition + matcher), push-to-talk fallback
 ├─ SVG Avatar      → expressions, gestures, viseme-style mouth driven by TTS boundary events
 ├─ SVG Board       → executes structured BoardActions progressively, synced to speech "beats"
 └─ REST (JWT)  ───────────────┐
                               ▼
FastAPI backend ── auth / prefs / documents / teach / quiz / memory
 ├─ llm.py        provider interface: anthropic | openai-compatible | offline (rule-based demo)
 ├─ rag.py        chunking + TF-IDF retrieval (swap-in: embeddings + Chroma/FAISS)
 ├─ docparse.py   PDF / DOCX / PPTX / TXT (+ optional OCR via pytesseract)
 ├─ intent.py     multilingual (Hindi/Hinglish/English) command + preference understanding
 └─ SQLAlchemy    SQLite (dev default) or PostgreSQL via DATABASE_URL
```

## 2. The teaching contract (LLM ⇄ frontend)

The backend always returns a **lesson script**: ordered `beats`. Each beat has `say` (spoken text),
optional `board` (list of BoardActions revealed *while* that beat is spoken), `gesture`, `emotion`.
The frontend speaks beat N, runs its board actions and avatar gesture, then moves to N+1.
That is how speech/board synchronisation works — beat-level, not word-level.

BoardAction types (validated server-side, rendered client-side as SVG): `heading, text, formula, shape
(circle/rect/line/arrow), dots, table, code, flow, highlight, clear, newpage`.

## 3. Data model
users, preferences (teacher, voice, avatar, language, personality, level, theme, memes, wake word),
documents (+ chunks table for RAG), progress (doc/topic/position), doubts, quiz_attempts, notes,
boards (saved JSON + page list), style_profiles (Teach-Me-Like-This), password_resets.

## 4. Multilingual engine
`intent.py` detects language preference and style requests in Hinglish ("simple karo", "board pe samjhao",
"Hindi aur English mix") deterministically *and* the LLM system prompt carries the preference. Preference
changes apply to the very next reply and are persisted.

## 5. Honest limitations
| Feature | Status in MVP | Fallback / upgrade |
|---|---|---|
| Natural Indian voices | Browser voices (`en-IN`, `hi-IN`, `gu-IN` if installed) | ElevenLabs / Azure Neural / Google WaveNet via `TTS_PROVIDER` (paid) |
| Lip sync | Mouth animates from TTS boundary events + syllable timing (approximate, not phoneme-accurate) | Rhubarb / Azure visemes |
| Wake word | Continuous SpeechRecognition + text matching (Chrome/Edge only, needs network) | Porcupine / openWakeWord; push-to-talk always available |
| Voice emotion | Rate/pitch/volume modulation per beat emotion | Neural TTS with SSML styles |
| Voice cloning | **Not implemented, by design.** Style profiles only capture pacing/structure | Authorised-voice provider with consent flow |
| Teach Me Like This | Audio/video clip → transcript supplied by user or browser; style stats (pace, pauses, question rate, example rate) | Server-side Whisper |
| OCR | Optional, needs Tesseract installed | Cloud OCR |
| Lesson quality | Needs an LLM key. Without one, an **offline demo teacher** handles a few built-in topics only | Set `LLM_PROVIDER` + key |
| Realistic/3D avatars | MVP ships SVG avatars (animated human, robot, cartoon, minimal) | Ready Player Me / Three.js VRM |
| Google OAuth | Backend endpoint verifies Google ID token; needs `GOOGLE_CLIENT_ID` | — |
| Email verification/reset | Link logged to console unless SMTP configured | SMTP env vars |

Free: FastAPI, SQLite, TF-IDF, Web Speech API, SVG. Paid/keyed: LLM API, premium TTS, Porcupine (free tier), cloud OCR.

## 6. Roadmap
1. **MVP (this repo):** auth, onboarding, prefs, document upload+RAG, classroom (PDF text, avatar, board, voice), doubts, quiz, notes, themes.
2. Server STT (Whisper), neural TTS provider, true visemes.
3. Chroma/pgvector embeddings, OCR pipeline, style-profile audio analysis.
4. Realistic/3D avatars, collaborative classes, mobile apps on the same API.
