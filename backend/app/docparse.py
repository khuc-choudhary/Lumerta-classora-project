"""Extract text from uploaded study material and build a structured topic roadmap."""
import io
import re

ALLOWED = {".pdf", ".docx", ".pptx", ".txt", ".md"}
MAGIC = {".pdf": b"%PDF", ".docx": b"PK", ".pptx": b"PK"}


def validate(filename: str, data: bytes) -> str:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == ".ppt":
        raise ValueError("Legacy .ppt is not supported. Please save it as .pptx and upload again.")
    if ext not in ALLOWED:
        raise ValueError(f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED))}")
    if ext in MAGIC and not data.startswith(MAGIC[ext]):
        raise ValueError("File content does not match its extension.")
    return ext


def _ocr_page(page) -> str:
    """Optional OCR for scanned pages. Needs pytesseract + Tesseract binary; silently skipped otherwise."""
    try:
        import pytesseract
        from PIL import Image
        out = []
        for img in page.images:
            out.append(pytesseract.image_to_string(Image.open(io.BytesIO(img.data))))
        return "\n".join(out)
    except Exception:
        return ""


def extract_pages(ext: str, data: bytes) -> tuple[list[str], list[str]]:
    """Returns (pages, warnings)."""
    warnings: list[str] = []
    if ext in (".txt", ".md"):
        text = data.decode("utf-8", errors="replace")
        # split long text into ~2500-char virtual pages on paragraph boundaries
        pages, cur = [], ""
        for para in text.split("\n\n"):
            if len(cur) + len(para) > 2500 and cur:
                pages.append(cur.strip()); cur = ""
            cur += para + "\n\n"
        if cur.strip():
            pages.append(cur.strip())
        return pages or [""], warnings
    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("This PDF is password protected.")
        pages = []
        for p in reader.pages:
            t = (p.extract_text() or "").strip()
            if len(t) < 20:
                t = _ocr_page(p).strip() or t
            pages.append(t)
        if sum(len(p) for p in pages) < 50:
            warnings.append("Very little text was found. If this is a scanned document, install Tesseract OCR "
                            "(pip install pytesseract pillow + Tesseract binary) and re-upload.")
        return pages, warnings
    if ext == ".docx":
        import docx
        d = docx.Document(io.BytesIO(data))
        lines = []
        for p in d.paragraphs:
            if not p.text.strip():
                continue
            lines.append(("## " if p.style.name.lower().startswith("heading") else "") + p.text.strip())
        text = "\n".join(lines)
        return extract_pages(".txt", text.encode())[0], warnings
    if ext == ".pptx":
        from pptx import Presentation
        prs = Presentation(io.BytesIO(data))
        pages = []
        for slide in prs.slides:
            parts = []
            for sh in slide.shapes:
                if sh.has_text_frame and sh.text_frame.text.strip():
                    parts.append(sh.text_frame.text.strip())
            pages.append("\n".join(parts))
        return pages, warnings
    raise ValueError("Unsupported file type")


_HEAD = re.compile(r"^(?:##\s+|(?:chapter|unit|module|section|topic)\s+\d+[:.\- ]|\d+(?:\.\d+){0,2}[.)]?\s+)(.{3,80})$", re.I)
_DEF = re.compile(r"^(.{3,60}?)\s+(?:is|are|means|refers to|is defined as)\s+(.{15,200})$", re.I)


def _is_heading(line: str) -> bool:
    line = line.strip()
    if not 3 <= len(line) <= 80 or line.endswith((".", ",", ";")):
        return False
    if _HEAD.match(line):
        return True
    return line.isupper() and len(line.split()) <= 8 and any(c.isalpha() for c in line)


def build_roadmap(pages: list[str]) -> list[dict]:
    topics: list[dict] = []
    cur = None
    for pi, text in enumerate(pages, start=1):
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            if _is_heading(line):
                cur = {"id": f"t{len(topics)+1}", "title": re.sub(r"^##\s+", "", line)[:80], "page": pi,
                       "body": [], "formulas": [], "definitions": []}
                topics.append(cur)
                continue
            if cur is None:
                cur = {"id": "t1", "title": "Introduction", "page": pi, "body": [], "formulas": [], "definitions": []}
                topics.append(cur)
            cur["body"].append(line)
            if "=" in line and len(line) < 80:
                cur["formulas"].append(line)
            m = _DEF.match(line)
            if m and len(cur["definitions"]) < 10:
                cur["definitions"].append(f"{m.group(1)} — {m.group(2)}")
    if len(topics) < 2 and pages:  # no usable headings: one topic per page group
        topics = []
        for pi, text in enumerate(pages, start=1):
            if text.strip():
                first = text.strip().splitlines()[0][:60]
                topics.append({"id": f"t{len(topics)+1}", "title": f"Page {pi}: {first}", "page": pi,
                               "body": text.splitlines(), "formulas": [], "definitions": []})
    for t in topics:
        body = " ".join(t.pop("body"))
        t["summary"] = body[:400]
        t["text"] = body[:30000]
        t["formulas"] = t["formulas"][:12]
    return topics

