import logging
import re
import smtplib
import uuid
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from . import docparse, docunderstand, hinglish, intent, llm, offline, pron, rag, teaching, tts
from .config import settings
from .db import Base, Chunk, Document, Item, Progress, Token, User, engine, get_db, now
from .security import current_user, hash_password, hash_token, make_jwt, new_token, optional_user, verify_password

log = logging.getLogger("lumetra")
logging.basicConfig(level=logging.INFO)
Base.metadata.create_all(engine)


def _migrate():
    """Tiny dev migration: add columns introduced after the first release."""
    from sqlalchemy import inspect, text
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    if "is_guest" not in cols:
        with engine.begin() as cx:
            cx.execute(text("ALTER TABLE users ADD COLUMN is_guest BOOLEAN DEFAULT 0"))
    if "analysis" not in {c["name"] for c in inspect(engine).get_columns("documents")}:
        with engine.begin() as cx:
            cx.execute(text("ALTER TABLE documents ADD COLUMN analysis JSON"))


_migrate()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="LUMETRA CLASSORA API", version="0.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

DEFAULT_PREFS = {
    "onboarded": False, "teacher": "aira", "teacher_name": "", "wake_word": "", "voice": "", "voice_rate": 0.95,
    "voice_pitch": 1.0, "voice_energy": 1.0, "avatar": "animated", "avatar_look": {"skin": "#f2c9a5", "hair": "#2b1b17", "outfit": "#7c5cff", "bg": "classroom"},
    "language": "hinglish", "level": "normal", "personality": "friendly", "memes": False, "theme": {"preset": "violet", "mode": "dark", "radius": "round", "font": 16, "board": "green"},
    "low_power": False, "listen_wake": False, "style_profile": None, "pron_accent": "en-IN",
}


# ---------- helpers ----------
def user_out(u: User) -> dict:
    return {"id": u.id, "email": "" if u.is_guest else u.email, "name": u.name, "verified": u.verified, "streak": u.streak,
            "is_guest": bool(u.is_guest),
            "prefs": {**DEFAULT_PREFS, **(u.prefs or {})}}


def touch_streak(u: User):
    today = date.today().isoformat()
    if u.last_active == today:
        return
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    u.streak = u.streak + 1 if u.last_active == yesterday else 1
    u.last_active = today


def send_mail(to: str, subject: str, body: str):
    if not settings.smtp_host:
        log.info("EMAIL (SMTP not configured) to=%s subject=%s\n%s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
    except Exception as e:  # never break signup on mail trouble
        log.error("SMTP failed: %s", e)


def issue_token(db: Session, user: User, kind: str, hours: int) -> str:
    raw, h = new_token()
    db.add(Token(user_id=user.id, kind=kind, token_hash=h, expires=now() + timedelta(hours=hours)))
    db.commit()
    return raw


def consume_token(db: Session, raw: str, kind: str) -> User:
    t = db.query(Token).filter_by(token_hash=hash_token(raw), kind=kind, used=False).first()
    exp = t.expires if t else None
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if not t or exp < now():
        raise HTTPException(400, "This link is invalid or has expired.")
    t.used = True
    db.commit()
    return db.get(User, t.user_id)


# ---------- auth ----------
class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@app.get("/api/health")
def health():
    return {"ok": True, "llm": settings.llm_provider if llm.configured() else "offline-demo",
            "google": bool(settings.google_client_id), "tts": tts.provider()}


@app.post("/api/auth/signup")
@limiter.limit("10/minute")
def signup(request: Request, body: SignupIn, db: Session = Depends(get_db), guest: User | None = Depends(optional_user)):
    if db.query(User).filter_by(email=body.email.lower()).first():
        raise HTTPException(409, "An account with this email already exists. Try logging in.")
    if guest and guest.is_guest:  # upgrade the guest session in place: all its learning history is kept
        u = guest
        u.email, u.name, u.password_hash, u.is_guest = body.email.lower(), body.name.strip(), hash_password(body.password), False
    else:
        u = User(email=body.email.lower(), name=body.name.strip(), password_hash=hash_password(body.password), prefs=dict(DEFAULT_PREFS))
        db.add(u)
    db.commit()
    raw = issue_token(db, u, "verify", 48)
    send_mail(u.email, "Verify your LUMETRA CLASSORA account", f"Welcome! Verify here: {settings.frontend_url}/verify?token={raw}")
    return {"token": make_jwt(u.id), "user": user_out(u)}


@app.post("/api/auth/guest")
@limiter.limit("20/hour")
def guest_session(request: Request, db: Session = Depends(get_db)):
    """Anonymous account so the app is usable without signing in. Signing up later keeps its data."""
    u = User(email=f"guest-{uuid.uuid4().hex}@guest.invalid", name="Guest", is_guest=True, prefs=dict(DEFAULT_PREFS))
    db.add(u); touch_streak(u); db.commit()
    return {"token": make_jwt(u.id), "user": user_out(u)}


@app.post("/api/auth/login")
@limiter.limit("15/minute")
def login(request: Request, body: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(email=body.email.lower()).first()
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Incorrect email or password.")
    touch_streak(u); db.commit()
    return {"token": make_jwt(u.id), "user": user_out(u)}


class GoogleIn(BaseModel):
    credential: str


@app.post("/api/auth/google")
@limiter.limit("15/minute")
def google_login(request: Request, body: GoogleIn, db: Session = Depends(get_db)):
    if not settings.google_client_id:
        raise HTTPException(501, "Google sign-in is not configured on this server (set GOOGLE_CLIENT_ID).")
    r = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": body.credential}, timeout=10)
    info = r.json()
    if r.status_code != 200 or info.get("aud") != settings.google_client_id or info.get("email_verified") not in (True, "true"):
        raise HTTPException(401, "Google sign-in could not be verified.")
    email = info["email"].lower()
    u = db.query(User).filter_by(email=email).first()
    if not u:
        u = User(email=email, name=info.get("name", email.split("@")[0]), verified=True, prefs=dict(DEFAULT_PREFS))
        db.add(u)
    touch_streak(u); db.commit()
    return {"token": make_jwt(u.id), "user": user_out(u)}


class EmailIn(BaseModel):
    email: EmailStr


@app.post("/api/auth/forgot")
@limiter.limit("5/minute")
def forgot(request: Request, body: EmailIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(email=body.email.lower()).first()
    if u:
        raw = issue_token(db, u, "reset", 1)
        send_mail(u.email, "Reset your LUMETRA CLASSORA password", f"Reset here (valid 1 hour): {settings.frontend_url}/reset?token={raw}")
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}  # same answer either way


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


@app.post("/api/auth/reset")
@limiter.limit("10/minute")
def reset(request: Request, body: ResetIn, db: Session = Depends(get_db)):
    u = consume_token(db, body.token, "reset")
    u.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True}


@app.post("/api/auth/verify")
def verify(body: dict, db: Session = Depends(get_db)):
    u = consume_token(db, str(body.get("token", "")), "verify")
    u.verified = True
    db.commit()
    return {"ok": True}


# ---------- profile & preferences ----------
@app.get("/api/me")
def me(u: User = Depends(current_user), db: Session = Depends(get_db)):
    touch_streak(u); db.commit()
    return user_out(u)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    prefs: dict | None = None


@app.patch("/api/me")
def update_me(body: ProfileIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.name is not None:
        u.name = body.name.strip()
    if body.prefs:
        allowed = {k: v for k, v in body.prefs.items() if k in DEFAULT_PREFS}
        u.prefs = {**DEFAULT_PREFS, **(u.prefs or {}), **allowed}
    db.commit()
    return user_out(u)


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=8, max_length=128)


@app.post("/api/me/password")
def change_password(body: PasswordIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current, u.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    u.password_hash = hash_password(body.new); db.commit()
    return {"ok": True}


@app.delete("/api/me/history")
def clear_history(u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Progress).filter_by(user_id=u.id).delete()
    db.query(Item).filter(Item.user_id == u.id, Item.kind.in_(["doubt", "quiz"])).delete()
    db.commit()
    return {"ok": True}


@app.delete("/api/me")
def delete_account(u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Chunk).filter_by(user_id=u.id).delete()
    db.query(Document).filter_by(user_id=u.id).delete()
    db.query(Progress).filter_by(user_id=u.id).delete()
    db.query(Item).filter_by(user_id=u.id).delete()
    db.query(Token).filter_by(user_id=u.id).delete()
    db.delete(u); db.commit()
    return {"ok": True}


# ---------- documents ----------
def own_doc(db: Session, u: User, doc_id: int) -> Document:
    d = db.get(Document, doc_id)
    if not d or d.user_id != u.id:
        raise HTTPException(404, "Document not found")
    return d


@app.post("/api/documents")
@limiter.limit("20/hour")
async def upload(request: Request, file: UploadFile = File(...), u: User = Depends(current_user), db: Session = Depends(get_db)):
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File too large (max {settings.max_upload_mb} MB).")
    if not data:
        raise HTTPException(400, "The file is empty.")
    try:
        ext = docparse.validate(file.filename or "", data)
        pages, warnings = docparse.extract_pages(ext, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("parse failed")
        raise HTTPException(422, f"Could not read this file ({e.__class__.__name__}). It may be corrupted.")
    pages, roadmap, analysis = docunderstand.build(ext, pages)       # clean -> classify -> structure -> rank concepts
    warnings = warnings + analysis["warnings"]
    title = re.sub(r"\.[A-Za-z0-9]+$", "", file.filename or "Untitled")[:120]
    d = Document(user_id=u.id, title=title, filename=file.filename or "", pages=pages, roadmap=roadmap, analysis=analysis)
    db.add(d); db.flush()
    for page, text in rag.chunk_pages(pages):
        db.add(Chunk(document_id=d.id, user_id=u.id, page=page, text=text))
    touch_streak(u); db.commit()
    return {"id": d.id, "title": d.title, "pages": len(pages), "topics": len(roadmap), "warnings": warnings,
            "doc_type": analysis["doc_type"], "ignored_lines": len(analysis["meta"])}


class TopicIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    text: str = Field(default="", max_length=20000)


@app.post("/api/documents/manual")
def manual_topic(body: TopicIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    text = body.text.strip() or body.title
    pages = docparse.extract_pages(".txt", text.encode())[0]
    roadmap, analysis = docunderstand.manual_topic(body.title, text)
    d = Document(user_id=u.id, title=body.title[:120], filename="manual-topic", pages=pages, roadmap=roadmap, analysis=analysis)
    db.add(d); db.flush()
    for page, t in rag.chunk_pages(pages):
        db.add(Chunk(document_id=d.id, user_id=u.id, page=page, text=t))
    db.commit()
    return {"id": d.id, "title": d.title}


@app.get("/api/documents")
def list_docs(u: User = Depends(current_user), db: Session = Depends(get_db)):
    docs = db.query(Document).filter_by(user_id=u.id).order_by(Document.id.desc()).all()
    done = {}
    for p in db.query(Progress).filter_by(user_id=u.id, completed=True).all():
        done[p.document_id] = done.get(p.document_id, 0) + 1
    return [{"id": d.id, "title": d.title, "pages": len(d.pages), "topics": len(d.roadmap), "completed": done.get(d.id, 0),
             "created_at": d.created_at.isoformat()} for d in docs]


def ensure_analysis(db: Session, d: Document) -> Document:
    """Documents uploaded before the current pipeline version are re-analysed from their stored text (headers/exam info removed,
    concepts ranked). Progress for topics that no longer exist is dropped."""
    if (d.analysis or {}).get("version") == docunderstand.VERSION:
        return d
    if d.filename == "manual-topic":
        text = d.roadmap[0].get("text", "") if d.roadmap else ""
        d.roadmap, d.analysis = docunderstand.manual_topic(d.title, text)
    else:
        ext = ".pptx" if d.filename.lower().endswith(".pptx") else ".txt"
        d.pages, d.roadmap, d.analysis = docunderstand.build(ext, d.pages)
        db.query(Chunk).filter_by(document_id=d.id).delete()
        for page, t in rag.chunk_pages(d.pages):
            db.add(Chunk(document_id=d.id, user_id=d.user_id, page=page, text=t))
    valid = [t["id"] for t in d.roadmap]
    db.query(Progress).filter(Progress.document_id == d.id, ~Progress.topic_id.in_(valid)).delete(synchronize_session=False)
    db.commit()
    return d


@app.get("/api/documents/{doc_id}")
def get_doc(doc_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = ensure_analysis(db, own_doc(db, u, doc_id))
    prog = {p.topic_id: {"completed": p.completed, "beat": p.beat} for p in db.query(Progress).filter_by(user_id=u.id, document_id=d.id)}
    a = d.analysis or {}
    return {"id": d.id, "title": d.title, "pages": d.pages, "roadmap": [{k: v for k, v in t.items() if k != "text"} for t in d.roadmap], "progress": prog,
            "analysis": {"doc_type": a.get("doc_type", "notes"), "ignored": a.get("meta", []), "difficult": a.get("difficult", []), "warnings": a.get("warnings", [])}}


@app.post("/api/documents/{doc_id}/reanalyze")
def reanalyze(doc_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = own_doc(db, u, doc_id)
    d.analysis = {}
    ensure_analysis(db, d)
    return {"ok": True, "topics": len(d.roadmap), "doc_type": d.analysis["doc_type"], "ignored_lines": len(d.analysis["meta"])}


@app.delete("/api/documents/{doc_id}")
def delete_doc(doc_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = own_doc(db, u, doc_id)
    db.query(Chunk).filter_by(document_id=d.id).delete()
    db.query(Progress).filter_by(document_id=d.id).delete()
    db.delete(d); db.commit()
    return {"ok": True}


# ---------- teaching ----------
def prefs_of(u: User) -> dict:
    return {**DEFAULT_PREFS, **(u.prefs or {})}


def excerpts(db: Session, u: User, doc_id: int | None, query: str, selection: str = "") -> str:
    parts = []
    if selection:
        parts.append(f"[Student-selected sentence] {selection}")
    for h in rag.search(db, u.id, selection + " " + query, doc_id):
        parts.append(f"[Page {h['page']}] {h['text']}")
    return "DOCUMENT EXCERPTS:\n" + "\n".join(parts) if parts else ""


MODE_NOTES = {
    "doubt": "Doubt mode: answer the student's question directly and briefly, then check if the doubt is cleared.",
    "revision": "Revision mode: recap the key points quickly with a mini-check question, do not teach from scratch.",
    "exam": "Exam preparation mode: give exam-ready definitions, key points, and show how to write the answer in easy language.",
    "practical": "Practical mode: teach step by step with a worked example the student can try; use the board for code/steps.",
    "quick": "Quick learning mode: at most 3 short beats, only the essentials.",
    "interview": "Interview mode: act as an interviewer. Ask ONE question, wait for the answer, then give feedback on the student's last answer before the next question.",
    "board": "Board teaching mode: explain mainly through diagrams, equations and step-by-step board demonstrations.",
}


def run_llm(prefs, msg, history, extra, mode: str = "classroom"):
    if MODE_NOTES.get(mode):
        extra = MODE_NOTES[mode] + "\n" + extra
    sp = prefs.get("style_profile")
    if sp and sp.get("prompt"):
        extra = sp["prompt"] + "\n" + extra
    try:
        return llm.generate_script(prefs, msg, history, extra)
    except llm.LLMError as e:
        raise HTTPException(502, str(e))


class LessonIn(BaseModel):
    document_id: int | None = None
    topic_id: str | None = None
    topic: str | None = Field(default=None, max_length=300)
    mode: str = "classroom"
    part: int = Field(default=0, ge=0, le=60)
    covered: list[str] = Field(default=[], max_length=20)


def merge_beats(script: dict, extra_beats: list[dict]):
    """Insert additional beats before the closing recap so the lesson still ends with a recap."""
    if not extra_beats:
        return
    bs = script["beats"]
    at = len(bs) - 1 if bs and bs[-1].get("kind") == "recap" else len(bs)
    bs[at:at] = extra_beats


@app.post("/api/teach/lesson")
@limiter.limit("30/minute")
def lesson(request: Request, body: LessonIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    prefs = prefs_of(u)
    title, text, topic, meta = body.topic or "", "", None, []
    if body.document_id:
        d = ensure_analysis(db, own_doc(db, u, body.document_id))
        meta = (d.analysis or {}).get("meta", [])
        topic = next((x for x in d.roadmap if x["id"] == body.topic_id), None)
        if body.topic_id and not topic:
            raise HTTPException(404, "Topic not found")
        if topic:
            title, text = topic["title"], topic.get("text", "")
    if not title:
        raise HTTPException(400, "Choose a topic or a document topic to learn.")
    touch_streak(u); db.commit()

    parts = teaching.split_parts(text) if text else [""]
    idx = min(body.part, len(parts) - 1)
    part_text = parts[idx]
    cl = teaching.checklist(topic, part_text) if topic else {"formulas": [], "definitions": []}

    is_q = bool(topic and topic.get("kind") == "question")           # an exam QUESTION is never read out; its concepts are taught
    concepts = (topic or {}).get("concepts", [])
    cterms = [c["term"] for c in concepts]

    if not llm.configured():  # offline demo walk-through (clearly limited, see offline.teach_text)
        if not part_text:
            return {"script": hinglish.add_speech(offline.script(prefs, title), prefs["language"]), "title": title, "part": 0, "parts": 1}
        if is_q:
            return {"script": hinglish.add_speech(offline.teach_question(prefs, title, concepts, topic.get("marks")), prefs["language"]), "title": title, "part": 0, "parts": 1}
        return {"script": hinglish.add_speech(offline.teach_text(prefs, title, part_text, cl["formulas"], cl["definitions"], idx, len(parts), concepts), prefs["language"]),
                "title": title, "part": idx, "parts": len(parts)}

    defs = [] if is_q else teaching.definition_sentences(part_text)     # exact book sentences: read verbatim first, THEN explained
    cl["definitions"] = [x for x in cl["definitions"] if not any(teaching.term_of(dd).lower() == x.split(" — ")[0].lower() for dd in defs)]   # handled by the definition method instead
    lines = [f"Teach this topic from the student's material: '{title}' (part {idx + 1} of {len(parts)}). Follow TEACHING MODE: explain in your own words, never read the text aloud, EXCEPT the definitions below which follow the DEFINITION -> UNDERSTANDING METHOD."]
    if defs:
        lines.append("DEFINITIONS - for each one, in this order: read it WORD FOR WORD (kind 'definition'), explain each phrase, connect, matching example, board, check question, recap. Finish one before the next:\n" + "\n".join(f"  {n + 1}. \"{d}\"" for n, d in enumerate(defs)))
    elif cl["definitions"]:
        lines.append("MUST TEACH these definitions: " + " | ".join(cl["definitions"]))
    if cl["formulas"]:
        lines.append("MUST TEACH and write on the board these formulas exactly: " + " | ".join(cl["formulas"]))
    if body.covered:
        lines.append("Already explained earlier in this session (do not repeat, connect to it): " + " / ".join(body.covered[-6:]))
    if idx > 0:
        lines.append("This continues the same topic: start with a one-line link to the previous part, no new introduction.")
    if idx < len(parts) - 1:
        lines.append("More parts follow: end this part with a short recap beat but do NOT ask the final check question yet (leave check empty).")
    if is_q:
        marks = topic.get("marks")
        lines = [f'This topic is an EXAM QUESTION taken from a question paper, NOT study material: "{part_text}"',
                 "NEVER read the question aloud. Never mention headers, marks tables, instructions or the university. TEACH the concept(s) it asks about from scratch "
                 f"(simple meaning, a real-life example, how it works), then give a short model-answer outline{f' suitable for {marks} marks' if marks else ''}.",
                 "Concepts asked about: " + ", ".join(cterms) + ". Everything you add is general knowledge, not from the student's book: mark examples src='extra' and say so.",
                 "EVERY example beat must set \"illustrates\" to one of those concepts and be directly about it."]
        if body.covered:
            lines.append("Already explained earlier in this session (do not repeat): " + " / ".join(body.covered[-6:]))
        extra = "\n".join(lines)
    else:
        if cterms:
            lines.append("KEY CONCEPTS of this part, ranked by importance (ONLY these are important technical terms; do not stop to define or stress ordinary everyday words): " + "; ".join(cterms))
        lines.append("NEVER SPEAK document boilerplate (page headers, marks, exam instructions, university/author names"
                     + (f"; for example: {' | '.join(meta[:8])}" if meta else "") + "). Do not read headings, titles or numbering aloud as text - introduce each topic naturally in your own words.")
        lines.append("EVERY example beat (kind 'example' or 'practical') must set \"illustrates\" to the key concept it explains and be directly about that concept - no generic or unrelated examples.")
        extra = "\n".join(lines) + f"\nDOCUMENT EXCERPTS:\n{part_text}"
    script = run_llm(prefs, f"Teach me: {title}", None, extra, body.mode)

    # QUALITY GATE: no copying of the book, no document boilerplate spoken, every example tied to a key concept.
    qi = teaching.quality_issues(script, "" if is_q else part_text, meta, cterms, title)
    retried = False
    if teaching.has_issues(qi):
        retried = True
        try:
            again = run_llm(prefs, f"Teach me: {title}", None, extra + "\n\nPROBLEMS IN YOUR PREVIOUS LESSON - FIX THEM:\n" + teaching.feedback(script, qi), body.mode)
            if sum(map(len, teaching.quality_issues(again, "" if is_q else part_text, meta, cterms, title).values())) < sum(map(len, qi.values())):
                script = again
        except HTTPException:
            pass
        teaching.drop_bad(script, teaching.quality_issues(script, "" if is_q else part_text, meta, cterms, title))

    miss = teaching.missing(script, cl)           # verify nothing important from the book was skipped
    if miss["formulas"] or miss["definitions"]:
        fix = ("Your lesson skipped these points from the material. Return ONLY beats (teaching style, not reading) that cover them: "
               + " | ".join(miss["definitions"] + miss["formulas"]) + f"\nDOCUMENT EXCERPTS:\n{part_text}")
        try:
            merge_beats(script, run_llm(prefs, f"Add the missing points of: {title}", None, fix, body.mode)["beats"][:6])
        except HTTPException:
            pass
        miss = teaching.missing(script, cl)
        merge_beats(script, teaching.patch_beats(miss, prefs["language"]))

    if defs:  # guarantee: exact reading + definition card on the board + enough explanation + a check question per definition
        teaching.enforce_verbatim(script, defs, prefs["language"])
        thin = teaching.thin_definitions(script, defs)[:4]

        def explain(d):
            fix = (f"The book definition below was read to the student, but your explanation after it is too thin. Return ONLY the explanation beats "
                   f"(kinds 'parts', 'connect', 'example', then a 'recap' ) following the DEFINITION -> UNDERSTANDING METHOD. Do NOT repeat the definition itself.\n"
                   f"DEFINITION: \"{d}\"\nDOCUMENT EXCERPTS:\n{part_text}")
            try:
                return run_llm(prefs, f"Explain this definition: {teaching.term_of(d)}", None, fix, body.mode)["beats"][:8]
            except HTTPException:
                return None

        # The extra explanations are independent of each other, so ask for them AT THE SAME TIME (not one after another):
        # same teaching quality, much less waiting. Two at a time keeps us under free-tier per-minute limits.
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(explain, thin))
        for d, new_beats in zip(thin, results):          # applied in the original order
            if new_beats:
                teaching.insert_explanation(script, d, new_beats)
    # Beats added by the retries above went through no gate yet: apply it to the FINAL lesson too.
    teaching.drop_bad(script, teaching.quality_issues(script, "" if is_q else part_text, meta, cterms, title))
    return {"script": hinglish.add_speech(script, prefs["language"]), "title": title, "part": idx, "parts": len(parts), "definitions": len(defs),
            "concepts": cterms, "quality_retry": retried}


class AskIn(BaseModel):
    message: str = Field(min_length=1, max_length=1500)
    document_id: int | None = None
    selection: str = Field(default="", max_length=1000)
    history: list[dict] = []
    last_topic: str = ""
    mode: str = "classroom"
    page: int | None = None
    covered: list[str] = Field(default=[], max_length=20)
    context: str = Field(default="", max_length=800)      # the definition/explanation the student is currently stuck on
    answering_check: bool = False                          # the message is the student's answer to the teacher's check question


ACK_NO_READ = {"english": "Okay, I won't read it out. I'll explain it in simple words instead.",
               "default": "Okay, main padhungi nahi, samjhaungi. Simple words mein explain karti hoon."}
ACKS = {
    "hinglish": "Okay, no problem! Ab main simple Hinglish use karungi. Difficult English words ko bhi easy Hindi mein explain kar dungi.",
    "english": "Sure! I will use simple English now.",
    "hindi": "ठीक है, अब मैं हिंदी में समझाऊँगी।",
    "gujarati": "સારું, હવે હું ગુજરાતીમાં સમજાવીશ.",
    "mix3": "Okay! Ab main English, Hindi aur Gujarati mix karke samjhaungi.",
}


@app.post("/api/teach/ask")
@limiter.limit("40/minute")
def ask(request: Request, body: AskIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    prefs = prefs_of(u)
    it = intent.analyse(body.message)
    changed = {}
    if it["language"] and it["language"] != prefs["language"]:
        changed["language"] = it["language"]
    if it["level"] and it["level"] != prefs["level"]:
        changed["level"] = it["level"]
    if it.get("personality") and it["personality"] != prefs.get("personality"):
        changed["personality"] = it["personality"]
    if changed:
        u.prefs = {**prefs, **changed}; prefs = prefs_of(u); db.commit()
    if it["control"]:
        return {"control": it["control"], "changed": changed, "intent": it}
    if it["faster"] or it["slower"]:
        rate = max(0.6, min(1.3, prefs["voice_rate"] + (-0.15 if it["slower"] else 0.15)))
        u.prefs = {**prefs, "voice_rate": round(rate, 2)}; db.commit()
        changed["voice_rate"] = round(rate, 2)
        if len(it["clean"].split()) <= 4:
            return {"control": "rate", "changed": changed, "intent": it}
    if it["read"]:  # explicit read-aloud request -> exact reading mode (otherwise teaching is always the default)
        src = body.selection
        if not src and body.document_id and body.page:
            d = own_doc(db, u, body.document_id)
            src = d.pages[body.page - 1] if 0 < body.page <= len(d.pages) else ""
        if not src.strip():
            raise HTTPException(400, "Select a paragraph, or open a document page, and I'll read it aloud.")
        return {"script": teaching.reading_script(src, prefs["language"]), "changed": changed, "intent": it, "open_board": False}
    notes = []
    if body.page:
        notes.append(f"The student is currently viewing page {body.page} of their material.")
    if body.covered:
        notes.append("Already explained in this session (do not repeat unless asked): " + " / ".join(body.covered[-6:]))
    if it["brief"]:
        notes.append("The student wants a SHORT explanation: at most 4 beats, essentials only.")
    if it["detail"]:
        notes.append("The student wants a DETAILED explanation: cover every point with examples.")
    if it["needs_simplifying"]:
        notes.append("The student said they did NOT understand. Re-explain differently: smaller steps, a NEW example or simpler analogy than before, simpler words. Do not repeat your previous explanation. "
                     "If a definition is involved, keep the book's wording unchanged and explain its phrases again more simply.")
    if body.context:
        notes.append(f"The concept the student is working on right now: \"{body.context}\"")
    if body.answering_check:
        notes.append("The student is ANSWERING your check question about the concept above. Evaluate the answer kindly in 2-3 short beats: say what is correct, gently fill in what is missing "
                     "(never contradict the book's definition), then say you will continue with the lesson. Do not start a new topic and do not ask another long question.")
    if it["want_board"]:
        notes.append("The student asked for a board explanation: use board actions (diagram/steps/example) progressively across beats.")
    if it["want_example"]:
        notes.append("Include a real-life example.")
    if body.last_topic:
        notes.append(f"Current lesson topic: {body.last_topic}")
    if body.selection:
        notes.append("The student selected a sentence from their document and wants it explained in context.")
    extra = "\n".join(notes) + "\n" + excerpts(db, u, body.document_id, it["clean"], body.selection)
    msg = it["clean"] or body.message
    if body.selection and len(msg.split()) < 4:
        msg = f"Explain this line: {body.selection}"
    script = run_llm(prefs, msg, body.history, extra, body.mode)
    if it["language"] in ACKS:  # explicit instruction is always acknowledged, even if already active
        script["beats"].insert(0, {"say": ACKS[it["language"]], "emotion": "friendly", "gesture": "nod", "board": []})
    if it["no_read"]:
        script["beats"].insert(0, {"say": ACK_NO_READ["english" if prefs["language"] == "english" else "default"], "emotion": "friendly", "gesture": "nod", "board": [], "kind": "intro", "src": "extra"})
    db.add(Item(user_id=u.id, kind="doubt", title=body.message[:120], data={"doc": body.document_id, "topic": body.last_topic}))
    touch_streak(u); db.commit()
    return {"script": hinglish.add_speech(script, prefs["language"]), "changed": changed, "intent": it, "open_board": it["want_board"]}


class ProgressIn(BaseModel):
    document_id: int
    topic_id: str
    beat: int = 0
    completed: bool = False


@app.post("/api/teach/progress")
def save_progress(body: ProgressIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_doc(db, u, body.document_id)
    p = db.query(Progress).filter_by(user_id=u.id, document_id=body.document_id, topic_id=body.topic_id).first()
    if not p:
        p = Progress(user_id=u.id, document_id=body.document_id, topic_id=body.topic_id)
        db.add(p)
    p.beat, p.completed, p.updated_at = body.beat, p.completed or body.completed, now()
    db.commit()
    return {"ok": True}


# ---------- quiz ----------
class QuizGenIn(BaseModel):
    document_id: int
    topic_id: str | None = None
    difficulty: str = "medium"
    count: int = Field(default=5, ge=1, le=10)


@app.post("/api/quiz/generate")
@limiter.limit("15/minute")
def quiz_generate(request: Request, body: QuizGenIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = own_doc(db, u, body.document_id)
    t = next((x for x in d.roadmap if x["id"] == body.topic_id), None) if body.topic_id else None
    text = (t or {}).get("text") or " ".join(d.pages)[:8000]
    title = (t or {}).get("title", d.title)
    qs = None
    if llm.configured():
        try:
            lang = llm.LANG_STYLE.get(prefs_of(u)["language"], "")
            raw = llm.generate_json(
                "You write quizzes ONLY from the given material. Language: " + lang + " Return JSON: "
                '{"questions":[{"type":"mcq|tf|fill|short","q":"","options":["only for mcq"],"answer":"","explain":""}]}',
                f"Difficulty: {body.difficulty}. Make {body.count} questions (mix of mcq, tf, fill, short) about '{title}'.\nMATERIAL:\n{text}")
            qs = [q for q in raw.get("questions", []) if q.get("q") and q.get("answer")][: body.count]
        except (llm.LLMError, ValueError, KeyError):
            qs = None
    if not qs:
        qs = offline.quiz_from_text(text, body.count)
    if not qs:
        raise HTTPException(422, "Not enough text in this topic to build a quiz.")
    item = Item(user_id=u.id, kind="quizset", title=title, data={"doc": d.id, "topic": body.topic_id, "questions": qs})
    db.add(item); db.commit()
    public = [{"q": q["q"], "type": q.get("type", "mcq"), "options": q.get("options")} for q in qs]
    return {"quiz_id": item.id, "title": title, "questions": public}


class QuizSubmitIn(BaseModel):
    quiz_id: int
    answers: list[str]


@app.post("/api/quiz/submit")
def quiz_submit(body: QuizSubmitIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    it = db.get(Item, body.quiz_id)
    if not it or it.user_id != u.id or it.kind != "quizset":
        raise HTTPException(404, "Quiz not found")
    results, correct = [], 0
    for q, a in zip(it.data["questions"], body.answers + [""] * 99):
        want = str(q["answer"]).strip().lower()
        got = a.strip().lower()
        ok = got == want if q.get("type") in ("mcq", "tf") else (bool(got) and (got == want or want in got or (len(got) > 3 and got in want)))
        correct += ok
        results.append({"q": q["q"], "your": a, "answer": q["answer"], "correct": ok, "explain": q.get("explain", "")})
    total = len(it.data["questions"])
    score = round(100 * correct / total)
    db.add(Item(user_id=u.id, kind="quiz", title=it.title, data={"doc": it.data["doc"], "topic": it.data["topic"], "score": score, "total": total}))
    if score >= 60 and it.data.get("topic"):
        p = db.query(Progress).filter_by(user_id=u.id, document_id=it.data["doc"], topic_id=it.data["topic"]).first()
        if p:
            p.completed = True
    touch_streak(u); db.commit()
    return {"score": score, "correct": correct, "total": total, "results": results}


# ---------- notes / boards / styles (generic items) ----------
class ItemIn(BaseModel):
    title: str = Field(default="", max_length=200)
    data: dict = {}


@app.get("/api/items/{kind}")
def list_items(kind: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if kind not in ("note", "board", "style", "pron"):
        raise HTTPException(404, "Unknown kind")
    rows = db.query(Item).filter_by(user_id=u.id, kind=kind).order_by(Item.id.desc()).all()
    return [{"id": r.id, "title": r.title, "data": r.data, "created_at": r.created_at.isoformat()} for r in rows]


@app.post("/api/items/{kind}")
def save_item(kind: str, body: ItemIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if kind not in ("note", "board", "style", "pron"):
        raise HTTPException(404, "Unknown kind")
    if len(str(body.data)) > 400_000:
        raise HTTPException(413, "Too large to save")
    r = Item(user_id=u.id, kind=kind, title=body.title or "Untitled", data=body.data)
    db.add(r); db.commit()
    return {"id": r.id}


@app.delete("/api/items/{item_id}")
def delete_item(item_id: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(Item, item_id)
    if not r or r.user_id != u.id:
        raise HTTPException(404, "Not found")
    db.delete(r); db.commit()
    return {"ok": True}


class NotesIn(BaseModel):
    document_id: int
    topic_id: str | None = None


@app.post("/api/notes/generate")
@limiter.limit("15/minute")
def notes_generate(request: Request, body: NotesIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = own_doc(db, u, body.document_id)
    topics = [t for t in d.roadmap if not body.topic_id or t["id"] == body.topic_id]
    if llm.configured():
        try:
            raw = llm.generate_json(
                "You make revision notes ONLY from the material, in simple language. Return JSON: "
                '{"summary":"","key_points":[""],"definitions":[""],"formulas":[""],"flashcards":[{"q":"","a":""}]}',
                "\n\n".join(f"## {t['title']}\n{t.get('text','')}" for t in topics)[:9000])
            return {"title": d.title, "source": "ai", **raw}
        except (llm.LLMError, ValueError):
            pass
    sents = [s for t in topics for s in re.split(r"(?<=[.!?])\s+", t.get("text", "")) if 30 < len(s) < 220]
    defs = [x for t in topics for x in t.get("definitions", [])]
    return {"title": d.title, "source": "extractive",
            "summary": " ".join(sents[:4]), "key_points": sents[:8], "definitions": defs[:8],
            "formulas": [f for t in topics for f in t.get("formulas", [])][:8],
            "flashcards": [{"q": x.split(" — ")[0] + "?", "a": x.split(" — ")[-1]} for x in defs[:8]]}


# ---------- Teach Me Like This (style analysis, NOT voice cloning) ----------
class StyleIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    transcript: str = Field(min_length=40, max_length=20000)
    duration_sec: float = Field(gt=5, le=3600)
    consent: bool


@app.post("/api/style/analyze")
def style_analyze(body: StyleIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if not body.consent:
        raise HTTPException(400, "Please confirm you have the right to use this recording for style analysis.")
    t = body.transcript
    words = len(t.split())
    sents = [s for s in re.split(r"[.!?।]+", t) if s.strip()]
    q = t.count("?")
    ex = len(re.findall(r"\b(for example|for instance|suppose|imagine|like|jaise|udaharan|example)\b", t, re.I))
    wpm = round(words / (body.duration_sec / 60))
    avg_len = round(words / max(1, len(sents)), 1)
    profile = {
        "wpm": wpm, "avg_sentence_words": avg_len, "question_rate": round(q / max(1, len(sents)), 2),
        "example_rate": round(ex / max(1, len(sents)), 2),
        "pace": "fast" if wpm > 165 else "slow" if wpm < 120 else "moderate",
        "sentences": "short and punchy" if avg_len < 12 else "long and detailed" if avg_len > 22 else "medium length",
        "interactive": q / max(1, len(sents)) > 0.12,
    }
    rate = 1.1 if profile["pace"] == "fast" else 0.85 if profile["pace"] == "slow" else 0.97
    profile["voice_rate"] = rate
    profile["prompt"] = (f"Teaching style '{body.name}': speak at a {profile['pace']} pace with {profile['sentences']} sentences; "
                         f"{'ask the student questions often' if profile['interactive'] else 'explain with fewer interruptions'}; "
                         f"{'use many examples' if profile['example_rate'] > 0.15 else 'use examples sparingly'}.")
    db.add(Item(user_id=u.id, kind="style", title=body.name, data=profile)); db.commit()
    return profile  # only derived numbers are stored; the transcript/clip is never kept


# ---------- pronunciation & speech ----------
def user_overrides(db: Session, u: User) -> dict[str, str]:
    return {i.title.lower(): i.data["ipa"] for i in db.query(Item).filter_by(user_id=u.id, kind="pron") if i.data.get("ipa")}


class PronIn(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    language: str = "english"
    accent: str = "en-IN"


@app.post("/api/pron/analyze")
@limiter.limit("120/minute")
def pron_analyze(request: Request, body: PronIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    ov = user_overrides(db, u)
    res = pron.analyze(body.text, ov)
    prov = tts.provider()
    preview = None
    if prov == "azure":
        preview = tts.azure_ssml(res["runs"], body.accent, prefs_of(u)["teacher"] == "aira", 1.0, 1.0, ov)
    return {**res, "provider": prov, "accent": body.accent, "ssml_preview": preview,
            "accent_note": "Phonetics come from a General American reference dictionary; the selected voice applies its own accent. Phoneme tags are only sent for curated/brand/your own corrections."}


@app.get("/api/pron/terms")
def pron_terms(u: User = Depends(current_user)):
    return {"terms": pron.technical_terms()}


class TTSIn(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    accent: str = "en-IN"
    slow: bool = False
    rate: float = Field(default=1.0, ge=0.5, le=1.5)
    pitch: float = Field(default=1.0, ge=0.5, le=1.5)


@app.get("/api/tts/status")
def tts_status():
    p = tts.provider()
    return {"provider": p, "requested": settings.tts_provider, "capabilities": tts.CAPS[p], "phonemes_enabled": tts.phonemes_enabled(p)}


@app.post("/api/tts")
@limiter.limit("90/minute")
def tts_speak(request: Request, body: TTSIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if tts.provider() == "browser":
        raise HTTPException(501, "No cloud speech provider is configured; use the browser voice.")
    try:
        audio = tts.synthesize(body.text, female=prefs_of(u)["teacher"] == "aira", accent=body.accent, rate=body.rate, pitch=body.pitch,
                               slow=body.slow, overrides=user_overrides(db, u))
    except tts.TTSError as e:
        raise HTTPException(502, str(e))
    return Response(audio, media_type="audio/mpeg")


@app.post("/api/pron/probe")
@limiter.limit("3/hour")
def pron_probe(request: Request, u: User = Depends(current_user)):
    try:
        return tts.probe_phonemes(female=prefs_of(u)["teacher"] == "aira")
    except tts.TTSError as e:
        raise HTTPException(502, str(e))


# ---------- learning history ----------
@app.get("/api/history")
def history(u: User = Depends(current_user), db: Session = Depends(get_db)):
    if u.is_guest:
        raise HTTPException(403, "Sign up or log in to keep and view your learning history.")
    docs = {d.id: d for d in db.query(Document).filter_by(user_id=u.id)}
    events = []
    for p in db.query(Progress).filter_by(user_id=u.id):
        d = docs.get(p.document_id)
        t = next((x for x in d.roadmap if x["id"] == p.topic_id), None) if d else None
        if d and t:
            events.append({"type": "lesson", "title": t["title"], "detail": d.title, "status": "completed" if p.completed else "in progress", "at": p.updated_at.isoformat()})
    for it in db.query(Item).filter(Item.user_id == u.id, Item.kind.in_(["doubt", "quiz"])):
        if it.kind == "doubt":
            events.append({"type": "doubt", "title": it.title, "detail": it.data.get("topic") or "", "status": "", "at": it.created_at.isoformat()})
        else:
            events.append({"type": "quiz", "title": it.title, "detail": f"{it.data.get('score')}% ({it.data.get('total')} questions)", "status": "passed" if it.data.get("score", 0) >= 60 else "needs revision", "at": it.created_at.isoformat()})
    events.sort(key=lambda e: e["at"], reverse=True)
    return {"events": events[:300], "totals": {"lessons": sum(e["type"] == "lesson" and e["status"] == "completed" for e in events),
            "doubts": sum(e["type"] == "doubt" for e in events), "quizzes": sum(e["type"] == "quiz" for e in events)}}


# ---------- dashboard ----------
@app.get("/api/dashboard")
def dashboard(u: User = Depends(current_user), db: Session = Depends(get_db)):
    docs = db.query(Document).filter_by(user_id=u.id).order_by(Document.id.desc()).all()
    prog = db.query(Progress).filter_by(user_id=u.id).order_by(Progress.updated_at.desc()).all()
    quizzes = db.query(Item).filter_by(user_id=u.id, kind="quiz").order_by(Item.id.desc()).all()
    by_topic = {}
    for qz in quizzes:
        by_topic.setdefault(qz.title, []).append(qz.data["score"])
    weak = [{"topic": k, "score": round(sum(v) / len(v))} for k, v in by_topic.items() if sum(v) / len(v) < 60]
    cont = None
    if prog:
        p = next((x for x in prog if not x.completed), prog[0])
        d = db.get(Document, p.document_id)
        t = next((x for x in d.roadmap if x["id"] == p.topic_id), None) if d else None
        if d and t:
            cont = {"document_id": d.id, "doc": d.title, "topic_id": t["id"], "topic": t["title"], "completed": p.completed}
    return {
        "streak": u.streak, "documents": [{"id": d.id, "title": d.title, "topics": len(d.roadmap)} for d in docs[:5]],
        "completed_topics": sum(1 for p in prog if p.completed), "continue": cont,
        "quiz_scores": [{"title": q.title, "score": q.data["score"]} for q in quizzes[:8]], "weak_topics": weak,
        "notes": db.query(Item).filter_by(user_id=u.id, kind="note").count(),
        "boards": db.query(Item).filter_by(user_id=u.id, kind="board").count(),
        "doubts": db.query(Item).filter_by(user_id=u.id, kind="doubt").count(),
    }


