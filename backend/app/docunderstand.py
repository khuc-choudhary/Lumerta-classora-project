"""Document understanding pipeline (replaces the old regex-only roadmap builder).

  extract text  ->  CLEAN  ->  classify document  ->  structure  ->  concepts  ->  teaching plan input
  (docparse)       remove repeated headers/footers, page numbers, exam/cover metadata; join wrapped lines; de-hyphenate
                   exam paper | slides | notes/textbook;  exam papers become QUESTIONS, never "topics" like the university name
                   headings are scored, question stems / list items / metadata are rejected
                   importance-ranked concepts: defined terms, formulas, TF-IDF key phrases; ordinary words are filtered by
                   real word frequency (wordfreq) - nothing is "important" just because it is long or capitalised

Every decision is explainable: concepts carry their evidence sentence and score; removed lines are kept in `analysis.meta`."""
import math
import re
import unicodedata
from collections import Counter

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
from wordfreq import zipf_frequency

from . import pron_data, teaching

VERSION = 2

GENERIC = {"example", "examples", "following", "given", "used", "using", "shown", "figure", "table", "chapter", "unit", "question", "questions", "answer", "answers",
           "marks", "mark", "note", "notes", "important", "case", "cases", "way", "ways", "type", "types", "kind", "thing", "things", "also", "called", "known", "based",
           "well", "one", "two", "three", "first", "second", "new", "use", "many", "may", "can", "will", "would", "should", "could", "like", "such", "etc", "eg", "ie",
           "page", "section", "topic", "summary", "introduction", "overview", "following", "below", "above", "etc", "make", "makes", "need", "needs", "get", "gets", "set"}
STOP = set(ENGLISH_STOP_WORDS) | GENERIC
SMALL = {"of", "and", "in", "the", "to", "for", "a", "an", "on", "with", "vs", "or", "as", "by", "at", "from"}

# ---------------------------------------------------------------- 1. CLEANING
_PAGE_NUM = re.compile(r"^\s*(page|pg\.?|p\.)\s*\d+(\s*(of|/)\s*\d+)?\s*$|^\s*[-–—]*\s*\d{1,4}\s*[-–—]*\s*$|^\s*\d+\s*/\s*\d+\s*$", re.I)
_STRONG_META = re.compile(
    r"(total|max(imum)?)\s*marks?\s*[:\-]?\s*\d+|\btime\s*(allowed)?\s*[:\-]|\b(roll|enrol+ment|seat)\s*(no|number)\b|\bsubject\s*(code|name)\b|^\s*date\s*[:\-]|"
    r"^\s*instructions?\b.*:?\s*$|\battempt\s+(all|any)\b.*questions?|\bfigures?\s+to\s+the\s+right\b|\bmake\s+suitable\s+assumptions\b|all\s+rights\s+reserved|©|copyright|"
    r"https?://|www\.|\b[\w.]+@[\w.]+\.\w+\b|for\s+(private|internal)\s+circulation|do\s+not\s+write\s+anything|use\s+of\s+(scientific\s+)?calculators?", re.I)
_ZONE_META = re.compile(r"university|institute|college|examination|\bexam\b|semester|\bsem\b|prepared\s+by|compiled\s+by|\bprof\.?\s|\bdr\.\s|\bfaculty\b|\bwinter\b|\bsummer\b|"
                        r"\b20\d\d\b|\bsubject\b|\bmid[- ]?term\b|\bquestion\s+paper\b", re.I)
_BULLET = re.compile(r"^(\s*[-•*▪●○◦–]\s+|\(?[a-zA-Z0-9]{1,2}[.)]\s+)")
_QSTART = re.compile(r"^\s*(Q\.?\s*\d+|Question\s*\d+)\b", re.I)
_CODE = re.compile(r"[{};]\s*$|^\s{4,}\S|^\s*(def|class|for|while|if|import|return|print|int|float|SELECT|INSERT|CREATE)\b", re.I)


def _is_zone_meta(line: str) -> bool:
    words = line.split()
    return bool(_ZONE_META.search(line)) and len(words) <= 14 and (line.isupper() or bool(re.search(r"[:|]|\s-\s|\d{4}", line)))


def _join_hyphen(a: str, b: str) -> str:
    """'super-' + 'vised' -> 'supervised' only when the joined word is a real word; keep 'data-' + 'driven' hyphenated."""
    left, right = re.findall(r"[A-Za-z]+$", a[:-1]), re.findall(r"^[A-Za-z]+", b)
    if left and right and zipf_frequency((left[0] + right[0]).lower(), "en") >= 1.5:
        return a[:-1] + b
    return a + b


def heading_level(t: str) -> int | None:
    """Scored heading test. Rejects question stems, list items with sentences, anything that ends like a sentence."""
    t = t.strip(); w = t.split()
    if not 1 <= len(w) <= 14 or len(t) > 95 or t[-1] in ".,;?!" or _QSTART.match(t):
        return None
    if re.search(r"\[\d+\]|\(\d+\s*marks?\)", t, re.I):
        return None
    m = re.match(r"^(\d+(?:\.\d+){0,3})[.)]?\s+(\S.*)$", t)
    if m and m.group(2)[:1].isupper() and len(m.group(2).split()) >= 1:
        return m.group(1).count(".") + 1
    if re.match(r"^(chapter|unit|module|section|topic|lesson|part)\s+[\w.-]+", t, re.I):
        return 1
    if t.startswith("##"):
        return 2
    letters = [c for c in t if c.isalpha()]
    if len(letters) >= 4 and t.upper() == t and not re.search(r"\d{4}", t):
        return 1
    if len(w) >= 2 and all(x[:1].isupper() or x.lower().strip(":") in SMALL for x in w) and "." not in t[:-1]:
        return 2
    return None


def clean_pages(pages: list[str]) -> tuple[list[str], list[str]]:
    """Returns (cleaned pages, removed non-teaching lines). Words are never altered except line-wrap joins/de-hyphenation."""
    n = len(pages)
    per_page = [[ln.rstrip() for ln in re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", unicodedata.normalize("NFKC", p)).splitlines()] for p in pages]
    sig = lambda s: re.sub(r"\d+", "#", re.sub(r"\s+", " ", s.strip().lower()))
    seen = Counter()
    for ls in per_page:
        ne = [x for x in ls if x.strip()]
        for s in {sig(x) for x in ne[:3] + ne[-3:]}:
            seen[s] += 1
    need = max(2, math.ceil(0.6 * n))
    repeated = {s for s, c in seen.items() if n >= 2 and c >= need and len(s) >= 3}
    removed: list[str] = []
    out_pages = []
    for pi, ls in enumerate(per_page):
        ne_idx = [i for i, x in enumerate(ls) if x.strip()]
        zone = set(ne_idx[:10] if pi == 0 else ne_idx[:3]) | set(ne_idx[-3:])
        kept = []
        for i, line in enumerate(ls):
            s = line.strip()
            if not s:
                kept.append(""); continue
            if sig(s) in repeated or _PAGE_NUM.match(s) or _STRONG_META.search(s) or (i in zone and _is_zone_meta(s)):
                if s not in removed:
                    removed.append(s)
                continue
            kept.append(line)
        out_pages.append("\n".join(_assemble(kept)))
    return out_pages, removed[:60]


def _assemble(lines: list[str]) -> list[str]:
    """Wrapped lines -> paragraphs. Headings, bullets, question lines and code keep their own lines."""
    out, cur = [], ""

    def flush():
        nonlocal cur
        if cur.strip():
            out.append(cur.strip())
        cur = ""
    for raw in lines:
        l = raw.strip()
        if not l:
            flush(); continue
        if _BULLET.match(l) or _QSTART.match(l) or _CODE.search(raw) or heading_level(l) is not None or l.upper() == "OR" or (" = " in l and len(l) < 140):
            flush(); out.append(l); continue
        if cur:
            if cur.endswith("-") and l[:1].islower():
                cur = _join_hyphen(cur, l)
            elif not re.search(r"[.!?:;]$", cur) or l[:1].islower():
                cur += " " + l
            else:
                flush(); cur = l
        else:
            cur = l
    flush()
    return out


# ---------------------------------------------------------------- 2. CLASSIFICATION
_MARKS = re.compile(r"\[\s*(\d{1,2})\s*\]|\(\s*(\d{1,2})\s*marks?\s*\)|\b(\d{1,2})\s*marks?\b", re.I)


def detect_type(ext: str, pages: list[str], removed: list[str]) -> str:
    text = "\n".join(pages)
    if ext == ".pptx":
        return "slides"
    q = len(re.findall(r"^\s*(Q\.?\s*\d+|Question\s*\d+)\b", text, re.I | re.M))
    marks = len(_MARKS.findall(text))
    exam_meta = sum(bool(re.search(r"total\s*marks|time\s*(allowed)?\s*[:\-]|attempt\s+(all|any)|roll\s*no", x, re.I)) for x in removed)
    if (q >= 2 and (marks >= 2 or exam_meta >= 1)) or (q >= 4) or (exam_meta >= 2 and marks >= 2):
        return "exam_paper"
    return "notes"


# ---------------------------------------------------------------- 3. EXAM PAPERS -> QUESTIONS
_Q_VERB = re.compile(r"^(?:q\.?\s*\d+\s*)?(?:\([a-z]\)\s*)?(define|what\s+(?:is|are)|why|how|explain|describe|discuss|differentiate(?:\s+between)?|distinguish(?:\s+between)?|"
                     r"compare|write(?:\s+a)?(?:\s+short)?(?:\s+note)?(?:\s+on)?|list|state|give|derive|prove|solve|find|calculate|draw|illustrate|justify|mention|enumerate)\b\s*(.*)$", re.I)
_SPLIT_TARGET = re.compile(r"\s+(?:with|using|in|by|for|of\s+the|from|along\s+with|and\s+its|and\s+give|and\s+explain|and\s+write)\s+|[,:;]|\s+(?:and|vs\.?|&)\s+", re.I)
_LEAD = re.compile(r"^(the|a|an|any|different|various|two|three|four|short\s+note\s+on|note\s+on|between)\s+", re.I)


def question_terms(stem: str) -> list[str]:
    """The concept(s) a question asks about: 'Define ML. Explain supervised learning with an example.' -> [ML, supervised learning]."""
    terms = []
    for sent in re.split(r"(?<=[.?!])\s+", _MARKS.sub("", stem)):
        m = _Q_VERB.match(sent.strip())
        if not m or re.match(r"^(how|why)\b", m.group(1), re.I):
            continue                                        # "How can it be reduced?" refers to an earlier concept
        tail = re.sub(r"[.?!]+$", "", m.group(2)).strip()
        tail = re.split(r"\s+(?:with\s+(?:an?\s+)?example|how\s+can|how\s+to|how\s+does|why)\b", tail, flags=re.I)[0]
        for part in re.split(r"\s+(?:and|vs\.?|&)\s+|,", tail):
            p = _LEAD.sub("", part.strip(" .?!-")).strip()
            p = re.sub(r"\s+(algorithms?|technique|method|concept|process)$", r" \1", p, flags=re.I)
            if p and 2 <= len(p) <= 60 and not all(x.lower() in STOP for x in re.findall(r"[A-Za-z]+", p)):
                terms.append(p)
    seen, out = set(), []
    for t in terms:
        if t.lower() not in seen:
            seen.add(t.lower()); out.append(t)
    return out[:5]


def parse_questions(pages: list[str]) -> list[dict]:
    text = "\n".join(pages); q_no, part, alt = None, None, False
    items: list[dict] = []
    for raw in text.splitlines():
        l = raw.strip()
        if not l:
            continue
        if l.upper() == "OR":
            alt = True; continue
        m = re.match(r"^(?:Q\.?\s*|Question\s*)(\d+)\.?\s*(.*)$", l, re.I)
        if m:
            q_no, rest, part = int(m.group(1)), m.group(2), None
            pm = re.match(r"^\(?([a-z])[.)]\s*(.*)$", rest)
            if pm:
                part, rest = pm.group(1), pm.group(2)
            items.append({"q": q_no, "part": part, "alt": alt, "text": rest}); alt = False
            continue
        pm = re.match(r"^\(([a-z])\)\s*(.*)$", l)
        if pm and q_no is not None:
            part = pm.group(1)
            items.append({"q": q_no, "part": part, "alt": alt, "text": pm.group(2)}); alt = False
            continue
        if items:
            items[-1]["text"] += " " + l
    out = []
    for it in items:
        txt = it["text"].strip()
        mk = _MARKS.search(txt)
        marks = int(next(g for g in mk.groups() if g)) if mk else None
        stem = re.sub(r"\s+", " ", _MARKS.sub("", txt)).strip(" .")
        if len(stem) >= 8:
            out.append({**it, "stem": stem, "marks": marks})
    return out


# ---------------------------------------------------------------- 4. CONCEPTS
_W = re.compile(r"[A-Za-z][A-Za-z'-]*")


def find_formulas(text: str) -> list[str]:
    """Formula expressions, cut out of their sentence ('...is given by MSE = (1/n) * sum (y - y_pred)^2' -> 'MSE = ...')."""
    out = []
    sents = [s for ln in text.splitlines() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", ln)]
    for sent in sents:
        if "=" not in sent or len(sent) > 260 or re.search(r"[=!<>]=|==", sent) and "(" not in sent and sent.count("=") > 2:
            continue
        m = re.search(r"(\b[A-Za-z_][A-Za-z_0-9]*(?:\s*\([^)]*\))?\s*=\s*.+)$", sent.strip().rstrip("."))
        if not m:
            continue
        expr = re.split(r"\s+(?:where|and\s+where|if|when|for|with|such\s+that)\s+|\.\s", m.group(1))[0].strip(" .,;")
        if 5 <= len(expr) <= 90 and expr not in out:
            out.append(expr)
    return out[:12]


def _defined_terms(text: str) -> dict[str, str]:
    """term(lower) -> exact definition sentence."""
    out = {}
    for s in teaching.definition_sentences(text, limit=20):
        out[teaching.term_of(s).lower().strip()] = s
    for m in re.finditer(r"\b([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,3})\s+\(([A-Z]{2,6})\)", text):          # "Artificial Intelligence (AI)"
        out.setdefault(m.group(1).lower(), m.group(0))
    for m in re.finditer(r"\b(?:known|referred\s+to|termed)\s+as\s+[\"“]?([A-Za-z][A-Za-z -]{2,40}?)[\"”]?(?=[,.;])", text):
        out.setdefault(m.group(1).lower().strip(), m.group(0))
    return out


def _candidates(text: str) -> Counter:
    c: Counter = Counter()
    forms: dict[str, Counter] = {}
    for sent in re.split(r"(?<=[.!?])\s+|\n", text):
        toks = _W.findall(sent)
        for n in (1, 2, 3):
            for i in range(len(toks) - n + 1):
                g = toks[i:i + n]
                low = [x.lower().strip("'-") for x in g]
                if any(x in STOP or len(x) < 3 for x in low):
                    continue
                key = " ".join(low)
                c[key] += 1
                forms.setdefault(key, Counter())[" ".join(g)] += 1
    c.forms = forms  # type: ignore[attr-defined]
    return c


def extract_concepts(text: str, title: str, other_texts: list[str], limit: int = 12) -> list[dict]:
    defined = _defined_terms(text)
    title_l = title.lower()
    cand = _candidates(text)
    N = len(other_texts) + 1
    low_others = [o.lower() for o in other_texts]
    scored: dict[str, dict] = {}
    for key, tf in cand.items():
        n = key.count(" ") + 1
        in_title = key in title_l
        is_def = key in defined
        if n == 1 and not is_def and (zipf_frequency(key, "en") >= 4.8 or (not in_title and (tf < 2 or zipf_frequency(key, "en") >= 3.8 or re.search(r"(ies|ses|ed|s)$", key)))):
            continue                                                  # ordinary word / inflected verb: never "important"
        if n >= 2 and tf < 2 and not is_def and not in_title:
            continue                                                  # one-off phrase: noise
        df = sum(1 for o in low_others if key in o) + 1
        idf = math.log((N + 1) / df) + 1
        score = (1 + math.log(tf)) * idf * (1 + 0.6 * (n - 1)) + (3 if in_title else 0) + (10 if is_def else 0)
        if n == 1 and zipf_frequency(key, "en") < 3.4:
            score += 1.5                                              # rare word = technical
        scored[key] = {"key": key, "score": score, "tf": tf, "def": is_def, "n": n}
    for term in defined:                                              # defined terms always qualify
        scored.setdefault(term, {"key": term, "score": 10 + 2, "tf": text.lower().count(term), "def": True, "n": term.count(" ") + 1})
    ranked = sorted(scored.values(), key=lambda d: -d["score"])
    chosen: list[dict] = []
    for d in ranked:
        if any(d["key"] != c["key"] and d["key"] in c["key"] and d["tf"] <= c["tf"] + 1 and not d["def"] for c in chosen):
            continue                                                  # 'learning' inside 'machine learning'
        chosen.append(d)
        if len(chosen) >= limit:
            break
    forms = getattr(cand, "forms", {})
    top = chosen[0]["score"] if chosen else 1
    out = []
    for d in chosen:
        disp = forms.get(d["key"], Counter()).most_common(1)
        term = disp[0][0] if disp else d["key"]
        if d["def"] and d["key"] in defined:
            term = re.sub(r"\s+", " ", d["key"]).title() if term.islower() else term
        ev = defined.get(d["key"]) or next((s for s in re.split(r"(?<=[.!?])\s+", text) if d["key"] in s.lower()), "")
        out.append({"term": term, "kind": "definition" if d["def"] else "term", "score": round(d["score"], 1), "count": d["tf"],
                    "importance": "high" if d["def"] or d["score"] >= 0.6 * top else "medium", "evidence": ev[:300]})
    for f in find_formulas(text)[:5]:
        name = f.split("=")[0].strip()
        if len(name) < 2:                                             # never a one-letter "concept": use the words that introduce the formula
            sent = next((s for s in re.split(r"(?<=[.!?])\s+|\n", text) if f in s), "")
            m = re.match(r"^(?:the|a|an)?\s*([A-Za-z ]{3,40}?)\s+(?:is|are|:)\s", sent, re.I)
            name = m.group(1).strip().lower() if m else "formula"
        out.append({"term": name, "kind": "formula", "score": 9.0, "count": 1, "importance": "high", "evidence": f})
    return out


def definitions_of(text: str) -> list[str]:
    """'term — rest of the sentence' for every real definition in the text (exact sentences are re-derived when teaching)."""
    return [f"{teaching.term_of(s)} — {s[len(teaching.term_of(s)):].strip()}" for s in teaching.definition_sentences(text, limit=12)]


def manual_topic(title: str, text: str) -> tuple[list[dict], dict]:
    """Roadmap + analysis for a topic the student typed in (no file)."""
    concepts = extract_concepts(text, title, [])
    topic = {"id": "t1", "title": title, "page": 1, "level": 1, "kind": "topic", "text": text[:30000], "summary": re.sub(r"\s+", " ", text)[:400],
             "concepts": concepts, "formulas": find_formulas(text), "definitions": definitions_of(text)}
    return [topic], {"version": VERSION, "doc_type": "notes", "meta": [], "warnings": [], "topics": 1, "difficult": difficult_words([text], [c["term"] for c in concepts])}


def difficult_words(texts: list[str], concepts: list[str]) -> list[str]:
    """Words worth a pronunciation icon: genuinely rare/technical (by word frequency), the curated technical list and concept words."""
    bag = Counter(w.lower().strip("'-") for t in texts for w in _W.findall(t))
    out = set()
    for w in bag:
        if len(w) >= 7 and w not in STOP and w not in pron_data.ACRONYMS and zipf_frequency(w, "en") < 3.0:
            out.add(w)
        elif w in pron_data.CURATED:
            out.add(w)
    for c in concepts:
        for w in _W.findall(c):
            wl = w.lower()
            if len(wl) >= 4 and wl not in STOP and wl not in pron_data.ACRONYMS and (zipf_frequency(wl, "en") < 4.0 or wl in pron_data.CURATED):
                out.add(wl)
    return sorted(out)[:150]


# ---------------------------------------------------------------- 5. STRUCTURE -> ROADMAP
def build(ext: str, raw_pages: list[str]) -> tuple[list[str], list[dict], dict]:
    """The whole pipeline. Returns (clean pages, roadmap topics, analysis)."""
    pages, removed = clean_pages(raw_pages)
    dtype = detect_type(ext, pages, removed)
    warnings: list[str] = []
    if dtype == "exam_paper":
        topics = _exam_topics(pages)
        if not topics:
            warnings.append("This looks like an exam paper but no questions could be read. Check the file.")
    else:
        topics = _note_topics(pages, ext)
    if not topics:
        warnings.append("No teachable content was found after removing headers, footers and exam/cover information.")
    texts = [t["text"] for t in topics]
    for i, t in enumerate(topics):
        if t["kind"] != "question":
            t["concepts"] = extract_concepts(t["text"], t["title"], texts[:i] + texts[i + 1:])
            t["formulas"] = find_formulas(t["text"])
            t["definitions"] = definitions_of(t["text"])
        t["summary"] = re.sub(r"\s+", " ", t["text"])[:400]
    all_concepts = [c["term"] for t in topics for c in t.get("concepts", [])]
    analysis = {"version": VERSION, "doc_type": dtype, "meta": removed, "warnings": warnings, "topics": len(topics),
                "difficult": difficult_words(texts, all_concepts)}
    return pages, topics, analysis


def _note_topics(pages: list[str], ext: str) -> list[dict]:
    topics: list[dict] = []
    cur: dict | None = None
    for pi, page in enumerate(pages, start=1):
        lines = [x for x in page.splitlines() if x.strip()]
        for idx, line in enumerate(lines):
            lvl = heading_level(line) if (ext != ".pptx" or idx == 0) else None
            nxt = lines[idx + 1] if idx + 1 < len(lines) else ""
            if ext == ".pptx" and idx == 0:
                lvl = lvl or 1
            if lvl is not None and (nxt or idx + 1 < len(lines) or pi < len(pages)):
                cur = {"id": f"t{len(topics) + 1}", "title": re.sub(r"^##\s*", "", line).strip(" :")[:90], "page": pi, "level": lvl, "kind": "topic", "body": []}
                topics.append(cur)
            else:
                if cur is None:
                    cur = {"id": "t0", "title": "Overview", "page": pi, "level": 1, "kind": "topic", "body": []}
                    topics.append(cur)
                cur["body"].append(line)
    out = []
    for t in topics:
        body = "\n".join(t.pop("body"))
        if len(body) >= 40:
            t["text"] = body[:30000]
            out.append(t)
    for i, t in enumerate(out, start=1):
        t["id"] = f"t{i}"
    return out


def _exam_topics(pages: list[str]) -> list[dict]:
    topics = []
    for i, q in enumerate(parse_questions(pages), start=1):
        label = f"Q{q['q']}{'(' + q['part'] + ')' if q['part'] else ''}{' OR' if q['alt'] else ''}"
        terms = question_terms(q["stem"])
        title = f"{label}: {', '.join(terms) if terms else q['stem'][:60]}"[:90]
        topics.append({"id": f"t{i}", "title": title, "page": 1, "level": 1, "kind": "question", "text": q["stem"], "marks": q["marks"],
                       "concepts": [{"term": t, "kind": "term", "score": 10.0, "count": 1, "importance": "high", "evidence": q["stem"]} for t in terms],
                       "formulas": [], "definitions": []})
    return topics
