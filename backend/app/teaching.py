"""Teaching-mode helpers: split a topic into lesson parts, build a must-cover checklist from the book,
verify the generated lesson did not skip formulas/definitions, and provide exact read-aloud mode."""
import re


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?।])\s+|\n+", text) if s.strip()]


def split_parts(text: str, max_chars: int = 2400) -> list[str]:
    """Long topics are taught in several parts so nothing has to be cut off."""
    parts, cur = [], ""
    for s in sentences(text):
        if len(cur) + len(s) > max_chars and cur:
            parts.append(cur.strip()); cur = ""
        cur += s + " "
    if cur.strip():
        parts.append(cur.strip())
    return parts or [""]


def _norm(s: str) -> str:
    return re.sub(r"[\s*_`]+", "", s.lower())


def checklist(topic: dict, part_text: str) -> dict:
    """Formulas and definitions from the book that appear in this part and MUST be taught."""
    low = _norm(part_text)
    formulas = [f for f in topic.get("formulas", []) if _norm(f) in low]
    defs = [d for d in topic.get("definitions", []) if _norm(d.split(" — ")[0]) in low]
    return {"formulas": formulas, "definitions": defs}


def missing(script: dict, cl: dict) -> dict:
    """What from the checklist is not covered anywhere in the lesson (speech or board)."""
    spoken = " ".join(b["say"] for b in script["beats"])
    boarded = " ".join(str(a.get("text", "")) + " " + " ".join(map(str, a.get("lines", []))) for b in script["beats"] for a in b["board"])
    blob = _norm(spoken + " " + boarded)
    return {
        "formulas": [f for f in cl["formulas"] if _norm(f) not in blob],
        "definitions": [d for d in cl["definitions"] if _norm(d.split(" — ")[0]) not in blob],
    }


def patch_beats(miss: dict, language: str) -> list[dict]:
    """Last-resort deterministic coverage when the model skipped something even after a retry."""
    en = language == "english"
    out = []
    for f in miss["formulas"]:
        out.append({"say": "One more important formula from your book. Please note it down." if en else "Ek aur important formula hai aapki book se. Isse note kar lo.",
                    "emotion": "serious", "gesture": "point", "kind": "technical", "src": "book",
                    "board": [{"type": "formula", "text": f[:120], "hl": ""}]})
    for d in miss["definitions"]:
        term, _, meaning = d.partition(" — ")
        out.append({"say": f"Important definition: {term}. {meaning}" if en else f"Ye definition important hai: {term}. Book ke hisab se: {meaning}",
                    "emotion": "serious", "gesture": "emphasis", "kind": "terms", "src": "book",
                    "board": [{"type": "text", "text": term[:60], "color": "yellow"}]})
    return out


def reading_script(text: str, language: str) -> dict:
    """EXACT read-aloud mode (only when the student asks to read). Sentences are spoken as written."""
    sents = sentences(text)[:40]
    beats, cur = [], ""
    for s in sents:
        if len(cur) + len(s) > 260 and cur:
            beats.append(cur.strip()); cur = ""
        cur += s + " "
    if cur.strip():
        beats.append(cur.strip())
    beats = beats[:14]
    return {"mode": "read", "source": "document", "check": "", "recap": "",
            "beats": [{"say": b, "emotion": "neutral", "gesture": "none", "kind": "read", "src": "book", "board": []} for b in beats]}


# ======================================================================
# DEFINITION -> UNDERSTANDING method
# For every important definition the lesson must: (1) read the book's EXACT sentence, (2) explain each part, (3) connect the
# parts, (4) give a matching example, (5) show it on the board, (6) check understanding, (7) recap - before the next one.
# The model is instructed to do this; the functions below GUARANTEE the verbatim reading and a minimum of explanation.
# ======================================================================
_DEF = re.compile(r"^(.{3,70}?)\s+(?:is|are|means|refers to|is defined as|are defined as|can be defined as|is called|are called)\s+(.{15,300})$", re.I)
_BAD_TERM_START = {"this", "that", "it", "there", "which", "here", "these", "those", "what", "when", "if", "who", "he", "she", "they", "we", "you", "i"}
EXPLAIN_KINDS = {"parts", "connect", "example", "practical", "technical", "meaning"}


_NOT_DEF = re.compile(r"^(given|calculated|computed|equal|obtained|denoted|written|shown|used|also|not|very|one\s+of|the\s+(most|same|first|second|following|only|best|main)|as\s|an?\s+example\s+of|defined\s+by\s+the\s+formula)\b", re.I)


def _definitional(rest: str) -> bool:
    """'X is <rest>': a real definition says what X IS (a kind, process, situation...), not 'X is given by w = ...' or 'X is the most common example'."""
    rest = rest.strip()
    return len(rest.split()) >= 5 and not _NOT_DEF.match(rest) and "=" not in rest[:40]


def definition_sentences(text: str, limit: int = 8) -> list[str]:
    """Exact definition sentences found in the book text (verbatim substrings, never rewritten)."""
    out = []
    for s in re.split(r"(?<=[.!?])\s+", text):
        s = s.strip()
        m = _DEF.match(s)
        if not m or not 35 <= len(s) <= 340:
            continue
        term, rest = m.group(1), m.group(2)
        if "," in term or len(term.split()) > 7 or term.lower().split()[0] in _BAD_TERM_START or not _definitional(rest):
            continue
        out.append(s)
    return out[:limit]


def term_of(d: str) -> str:
    m = _DEF.match(d)
    return m.group(1) if m else " ".join(d.split()[:3])


_CUT = re.compile(r",\s*|\s+(?:in which|which|that|where|whereby|so that|by|using|from|and|or|to)\s+", re.I)


def phrases(d: str, max_parts: int = 5) -> list[str]:
    """Meaningful phrases of a definition (whole phrases, never single letters). Each is an exact substring of `d`."""
    cuts, last, out = [], 0, []
    for m in _CUT.finditer(d.rstrip(".")):
        cuts.append((last, m.start())); last = m.end()
    cuts.append((last, len(d.rstrip("."))))
    for a, b in cuts:
        chunk = d[a:b].strip(" ,;.")
        if len(chunk) >= 8:
            out.append(chunk)
        elif out:                       # too short to stand alone: merge into the previous phrase
            continue
    return out[:max_parts] if len(out) >= 2 else [d.rstrip(".")]


def verbatim_beat(d: str) -> dict:
    return {"say": d, "emotion": "serious", "gesture": "point", "kind": "definition", "src": "book",
            "board": [{"type": "definition", "text": d[:320], "parts": phrases(d)}]}


def _lead(language: str) -> dict:
    en = language == "english"
    return {"say": "First, let's listen to the exact definition from your book." if en else "Pehle book ki definition ko exactly sunte hain.",
            "emotion": "calm", "gesture": "open", "kind": "intro", "src": "book", "board": []}


def _check(language: str, term: str) -> dict:
    en = language == "english"
    return {"say": f"Now tell me in your own words: what is {term}?" if en else f"Ab apne words mein batao: {term} kya hota hai?",
            "emotion": "curious", "gesture": "open", "kind": "check", "src": "extra", "board": []}


def enforce_verbatim(script: dict, defs: list[str], language: str) -> None:
    """Guarantee each definition is read EXACTLY as in the book (own beat + definition card on the board) and that a
    comprehension check closes its block. Never rewrites the book's words."""
    for d in defs:
        nd, beats = _norm(d), script["beats"]
        idx = next((i for i, b in enumerate(beats) if b.get("kind") == "definition" and nd in _norm(b["say"])), None)
        if idx is None:                                                   # a beat marked 'definition' but paraphrased: replace with the exact text
            para = next((i for i, b in enumerate(beats) if b.get("kind") == "definition" and _norm(term_of(d)) in _norm(b["say"])), None)
            if para is not None:
                beats[para] = verbatim_beat(d); idx = para
        if idx is None:
            at = next((i for i, b in enumerate(beats) if _norm(term_of(d)) in _norm(b["say"])), None)
            if at is None:
                at = len(beats) - 1 if beats and beats[-1].get("kind") == "recap" else len(beats)
            beats[at:at] = [_lead(language), verbatim_beat(d)]
        else:
            if not any(a.get("type") == "definition" for a in beats[idx]["board"]):
                beats[idx]["board"].insert(0, {"type": "definition", "text": d[:320], "parts": phrases(d)})
            beats[idx]["src"] = "book"
        # a comprehension check at the end of this definition's block
        s, e = block(script, d)
        if s is not None and not any(b.get("kind") == "check" for b in script["beats"][s + 1:e]):
            script["beats"].insert(e - 1 if script["beats"][e - 1].get("kind") == "recap" and e - 1 > s else e, _check(language, term_of(d)))


def _verbatim_idx(script: dict, d: str) -> int | None:
    nd = _norm(d)
    return next((i for i, b in enumerate(script["beats"]) if b.get("kind") == "definition" and nd in _norm(b["say"])), None)


def block(script: dict, d: str) -> tuple[int | None, int]:
    """(start, end) beat range of a definition's block: from its verbatim beat to the next definition beat (or the end)."""
    s = _verbatim_idx(script, d)
    if s is None:
        return None, len(script["beats"])
    e = next((i for i in range(s + 1, len(script["beats"])) if script["beats"][i].get("kind") == "definition"), len(script["beats"]))
    if e < len(script["beats"]) and e - 1 > s and script["beats"][e - 1].get("kind") == "intro":
        e -= 1                      # the next definition's lead-in line belongs to the NEXT block
    return s, e


def thin_definitions(script: dict, defs: list[str]) -> list[str]:
    """Definitions followed by too little explanation (fewer than 3 explanation beats before the next definition)."""
    thin = []
    for d in defs:
        s, e = block(script, d)
        if s is not None and sum(1 for b in script["beats"][s + 1:e] if b.get("kind") in EXPLAIN_KINDS) < 3:
            thin.append(d)
    return thin


def insert_explanation(script: dict, d: str, new_beats: list[dict]) -> None:
    """Put explanation beats right after the definition's verbatim beat and before its check question;
    a recap goes AFTER the check (method order: explain -> example -> check understanding -> recap)."""
    s, e = block(script, d)
    if s is None:
        return
    clean = [b for b in new_beats if b.get("kind") != "definition"]
    main = [b for b in clean if b.get("kind") != "recap"]
    recaps = [b for b in clean if b.get("kind") == "recap"][:1]
    beats = script["beats"]
    chk = next((i for i in range(s + 1, e) if beats[i].get("kind") == "check"), None)
    if chk is None:
        at = next((i for i in range(s + 1, e) if beats[i].get("kind") == "recap"), e)
        beats[at:at] = main
        beats[at + len(main):at + len(main)] = recaps
    else:
        beats[chk:chk] = main
        if not any(b.get("kind") == "recap" for b in beats[chk + len(main) + 1:e + len(main)]):
            beats[chk + len(main) + 1:chk + len(main) + 1] = recaps



# ======================================================================
# QUALITY GATE: the lesson must TEACH - not read the book, not speak document boilerplate, not give unrelated examples.
# ======================================================================
def _words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", s.lower())


def _ngrams(ws: list[str], n: int) -> set:
    return {tuple(ws[i:i + n]) for i in range(len(ws) - n + 1)}


def quality_issues(script: dict, source: str, meta_lines: list[str], concept_terms: list[str], title: str, n: int = 8) -> dict:
    """Indexes of beats that (a) copy >= n consecutive words from the book (except exact definitions/readings),
    (b) speak removed document boilerplate (headers, marks, instructions), (c) give an example that is not tied to a key concept."""
    src = _ngrams(_words(source), n)
    # A removed header/footer is "spoken" if the lesson repeats ANY distinctive piece of it (a fragment, or 4+ words in a row),
    # not only when it quotes the whole line.
    frags, grams = [], set()
    for m in meta_lines:
        frags += [_norm(f) for f in re.split(r"\s*[|:]\s*|\s+-\s+|\s{2,}", m) if len(_norm(f)) >= 10]
        grams |= _ngrams(_words(m), 4)
    terms = [t.lower() for t in concept_terms] + [w for w in _words(title) if len(w) > 3]
    res = {"copied": [], "meta": [], "bad_examples": []}
    for i, b in enumerate(script["beats"]):
        k, say = b.get("kind"), b["say"]
        if any(f in _norm(say) for f in frags) or (grams and (_ngrams(_words(say), 4) & grams)):
            res["meta"].append(i)
        if k not in ("definition", "read", "intro", "check") and src and (_ngrams(_words(say), n) & src):
            res["copied"].append(i)
        if k in ("example", "practical"):
            ill = (b.get("illustrates") or "").lower().strip()
            if not ill or not any(ill in t or t in ill for t in terms):
                res["bad_examples"].append(i)
    return res


def has_issues(qi: dict) -> bool:
    return bool(qi["copied"] or qi["meta"] or qi["bad_examples"])


def feedback(script: dict, qi: dict) -> str:
    beats, out = script["beats"], []
    if qi["copied"]:
        out.append("You COPIED the book instead of teaching. Explain these in your own simple words (a definition may be read exactly, nothing else): "
                   + " | ".join(f'"{beats[i]["say"][:140]}"' for i in qi["copied"][:5]))
    if qi["meta"]:
        out.append("You spoke document boilerplate (headers/marks/instructions) that must never be spoken: " + " | ".join(f'"{beats[i]["say"][:100]}"' for i in qi["meta"][:4]))
    if qi["bad_examples"]:
        out.append("These examples are unrelated to a key concept or lack the 'illustrates' field. Replace each with an example DIRECTLY about the concept: "
                   + " | ".join(f'"{beats[i]["say"][:100]}"' for i in qi["bad_examples"][:4]))
    return "\n".join(out)


def drop_bad(script: dict, qi: dict) -> int:
    """Last resort after one retry: remove beats that speak boilerplate and examples unrelated to the concepts. Never touches definitions."""
    bad = sorted({*qi["meta"], *qi["bad_examples"]}, reverse=True)
    n = 0
    for i in bad:
        if script["beats"][i].get("kind") != "definition" and len(script["beats"]) > 1:
            del script["beats"][i]; n += 1
    return n
