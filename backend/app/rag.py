"""Retrieval over a user's own documents. TF-IDF by default (no model download, fully local).
To upgrade: implement `search` with embeddings + Chroma/pgvector; the interface stays the same."""
import re

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
from sqlalchemy.orm import Session

from .db import Chunk


def chunk_pages(pages: list[str], size: int = 700) -> list[tuple[int, str]]:
    out = []
    for pi, text in enumerate(pages, start=1):
        sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
        cur = ""
        for s in sentences:
            if len(cur) + len(s) > size and cur:
                out.append((pi, cur.strip())); cur = ""
            cur += s + " "
        if cur.strip():
            out.append((pi, cur.strip()))
    return out


def search(db: Session, user_id: int, query: str, document_id: int | None = None, k: int = 4) -> list[dict]:
    q = db.query(Chunk).filter(Chunk.user_id == user_id)
    if document_id:
        q = q.filter(Chunk.document_id == document_id)
    chunks = q.all()
    if not chunks or not query.strip():
        return []
    try:
        vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2)).fit([c.text for c in chunks] + [query])
        scores = linear_kernel(vec.transform([query]), vec.transform([c.text for c in chunks]))[0]
    except ValueError:
        return []
    ranked = sorted(zip(scores, chunks), key=lambda x: -x[0])[:k]
    return [{"page": c.page, "text": c.text, "score": float(s)} for s, c in ranked if s > 0.02]
