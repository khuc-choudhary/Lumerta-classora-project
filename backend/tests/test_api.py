import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/t.db"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["LLM_PROVIDER"] = "offline"   # tests use the offline teacher, never the real AI key from .env

from fastapi.testclient import TestClient  # noqa: E402

from app import intent  # noqa: E402
from app.main import app, limiter  # noqa: E402

limiter.enabled = False
c = TestClient(app)

DOC = b"""CHAPTER 1: MACHINE LEARNING
Machine learning is a method where computers learn patterns from data without explicit programming.
Supervised learning means training a model on labelled examples to predict outcomes.
y = m x + c

CHAPTER 2: DATABASES
A primary key is a column that uniquely identifies every row in a table of records.
Normalization is the process of organising data to reduce duplication across many tables.
"""


def signup(email):
    r = c.post("/api/auth/signup", json={"name": "T", "email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_auth_flow():
    h = signup("a@example.com")
    assert c.post("/api/auth/signup", json={"name": "T", "email": "a@example.com", "password": "password123"}).status_code == 409
    assert c.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-pass"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "a@example.com", "password": "password123"}).status_code == 200
    assert c.get("/api/me").status_code == 401
    assert c.get("/api/me", headers=h).json()["email"] == "a@example.com"


def test_docs_isolation_and_roadmap():
    h1, h2 = signup("u1@example.com"), signup("u2@example.com")
    r = c.post("/api/documents", headers=h1, files={"file": ("ml.txt", DOC)})
    assert r.status_code == 200 and r.json()["topics"] == 2, r.text
    did = r.json()["id"]
    assert c.get(f"/api/documents/{did}", headers=h2).status_code == 404
    assert c.get("/api/documents", headers=h2).json() == []
    assert c.post("/api/documents", headers=h1, files={"file": ("x.exe", b"MZ")}).status_code == 400
    assert c.post("/api/documents", headers=h1, files={"file": ("x.pdf", b"not a pdf")}).status_code == 400
    d = c.get(f"/api/documents/{did}", headers=h1).json()
    assert d["roadmap"][0]["title"].startswith("CHAPTER 1") or "MACHINE" in d["roadmap"][0]["title"]

    les = c.post("/api/teach/lesson", headers=h1, json={"document_id": did, "topic_id": "t1"})
    assert les.status_code == 200 and les.json()["script"]["beats"]
    q = c.post("/api/quiz/generate", headers=h1, json={"document_id": did, "topic_id": "t2", "count": 2})
    assert q.status_code == 200, q.text
    assert "answer" not in str(q.json())
    s = c.post("/api/quiz/submit", headers=h1, json={"quiz_id": q.json()["quiz_id"], "answers": ["x", "y"]})
    assert s.status_code == 200 and s.json()["total"] >= 1
    assert c.post("/api/quiz/submit", headers=h2, json={"quiz_id": q.json()["quiz_id"], "answers": []}).status_code == 404


def test_hinglish_intent_and_board():
    h = signup("h@example.com")
    r = c.post("/api/teach/ask", headers=h, json={"message": "AIRA Ma'am, mujhe English samajh nahi aa rahi. Hindi aur English mix karke samjhao."}).json()
    assert r["intent"]["language"] == "hinglish"
    assert "Hinglish" in r["script"]["beats"][0]["say"]
    r = c.post("/api/teach/ask", headers=h, json={"message": "AIRA Ma'am, 2 + 2 board pe samjhao"}).json()
    assert r["open_board"] and any(b["board"] for b in r["script"]["beats"])
    assert c.post("/api/teach/ask", headers=h, json={"message": "NEX Sir, stop"}).json()["control"] == "stop"
    assert c.post("/api/teach/ask", headers=h, json={"message": "Sir, board clear kar do"}).json()["control"] == "clear_board"
    assert c.get("/api/me", headers=h).json()["prefs"]["language"] == "hinglish"


def test_intent_levels():
    assert intent.analyse("NEX Sir, please explain in English")["language"] == "english"
    assert intent.analyse("Ma'am heavy English mat use karo")["language"] == "hinglish"
    assert intent.analyse("sir thoda simple language mein explain karo")["level"] == "very_simple"
    assert intent.analyse("AIRA, speak slowly")["slower"]


def test_guest_then_signup_keeps_history():
    g = c.post("/api/auth/guest").json()
    h = {"Authorization": "Bearer " + g["token"]}
    assert g["user"]["is_guest"] and g["user"]["email"] == ""
    assert c.post("/api/documents", headers=h, files={"file": ("g.txt", DOC)}).status_code == 200
    c.post("/api/teach/ask", headers=h, json={"message": "what is machine learning?"})
    assert c.get("/api/history", headers=h).status_code == 403
    r = c.post("/api/auth/signup", headers=h, json={"name": "Real", "email": "real@example.com", "password": "password123"}).json()
    assert r["user"]["id"] == g["user"]["id"] and not r["user"]["is_guest"]
    hist = c.get("/api/history", headers={"Authorization": "Bearer " + r["token"]}).json()
    assert hist["totals"]["doubts"] == 1 and any(e["type"] == "doubt" for e in hist["events"])
    assert len(c.get("/api/documents", headers=h).json()) == 1


def test_read_mode_only_on_request(monkeypatch):
    h = signup("rd@example.com")
    sel = "Machine learning is a method where computers learn patterns from data. Supervised learning needs labelled examples."
    r = c.post("/api/teach/ask", headers=h, json={"message": "AIRA Ma'am, is paragraph ko read karo", "selection": sel}).json()
    assert r["script"]["mode"] == "read"
    assert " ".join(b["say"] for b in r["script"]["beats"]).split() == sel.split()      # exact, word for word
    r = c.post("/api/teach/ask", headers=h, json={"message": "Ma'am read mat karo, samjhao", "selection": sel}).json()
    assert r["script"].get("mode") != "read" and "samjhaungi" in r["script"]["beats"][0]["say"]
    r = c.post("/api/teach/ask", headers=h, json={"message": "explain this line", "selection": sel}).json()
    assert r["script"].get("mode") != "read"
    assert c.post("/api/teach/ask", headers=h, json={"message": "read this paragraph"}).status_code == 400   # nothing to read


def test_lesson_covers_all_formulas_and_definitions(monkeypatch):
    from app import llm
    h = signup("cov@example.com")
    did = c.post("/api/documents", headers=h, files={"file": ("ml.txt", DOC)}).json()["id"]
    calls = []

    def fake(prefs, msg, history=None, extra=""):
        calls.append(extra)
        beat = {"say": "Okay, let's understand this simply.", "emotion": "friendly", "gesture": "open", "board": [], "kind": "intro", "src": "book"}
        recap = {"say": "Quick recap.", "emotion": "calm", "gesture": "none", "board": [], "kind": "recap", "src": "book"}
        return {"beats": [beat, recap], "source": "document", "check": "Clear?", "recap": "covered ML basics", "analysis": {}}
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "generate_script", fake)
    r = c.post("/api/teach/lesson", headers=h, json={"document_id": did, "topic_id": "t1"}).json()
    assert "MUST TEACH" in calls[0] and "never read the text aloud" in calls[0]
    beats = r["script"]["beats"]
    assert any(a.get("type") == "formula" and "y = m x + c" in a["text"] for b in beats for a in b["board"])   # formula forced onto board
    assert beats[-1]["kind"] == "recap"                                                                     # still ends with recap
    assert len(calls) >= 2                                                                                  # retry for missing points (and thin definitions)


def test_hinglish_speech_uses_devanagari_for_hindi_words():
    from app.hinglish import speechify
    assert speechify("Chalo ab dekhte hain.") == "चलो अब देखते हैं."
    out = speechify("Ab machine learning ka simple meaning dekho, to me main idea do")
    assert out.startswith("अब machine learning का simple meaning देखो")
    assert "to me main idea do" in out                      # English words that look like Hindi are left alone
    h = signup("sp@example.com")
    r = c.post("/api/teach/ask", headers=h, json={"message": "AIRA Ma'am, 2 + 2 board pe samjhao"}).json()
    assert all(b["speech"] for b in r["script"]["beats"]) and any("अब" in b["speech"] or "पहले" in b["speech"] for b in r["script"]["beats"])
    assert r["script"]["beats"][0]["say"].isascii()          # caption stays readable Roman Hinglish


ML_DEF = "Machine learning is a method where computers learn patterns from data without explicit programming."
SL_DEF = "Supervised learning means training a model on labelled examples to predict outcomes."


def _beat(say, kind, src="extra", board=None, illustrates=""):
    return {"say": say, "emotion": "calm", "gesture": "none", "board": board or [], "kind": kind, "src": src, "illustrates": illustrates}


def test_definition_is_read_verbatim_then_explained_then_checked(monkeypatch):
    from app import llm
    h = signup("def@example.com")
    did = c.post("/api/documents", headers=h, files={"file": ("ml.txt", DOC)}).json()["id"]
    calls = []

    def fake(prefs, msg, history=None, extra=""):
        calls.append(extra)
        if "too thin" in extra:     # the retry: return proper explanation beats for the definition
            return {"beats": [_beat("Look at the first phrase: it means computers learn on their own.", "parts"), _beat("Together, the parts mean learning from examples.", "connect"),
                              _beat("Extra example: a spam filter learns from marked emails.", "example", illustrates="machine learning"), _beat("Recap: machines learn from data.", "recap")], "source": "mixed", "check": "", "recap": "x", "analysis": {}}
        # a lazy first answer: PARAPHRASES the definitions and explains almost nothing
        return {"beats": [_beat("ML means computers learning stuff from data, basically.", "meaning", "book"), _beat("Supervised means using labels.", "meaning", "book")],
                "source": "document", "check": "Clear?", "recap": "ok", "analysis": {}}
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "generate_script", fake)
    beats = c.post("/api/teach/lesson", headers=h, json={"document_id": did, "topic_id": "t1"}).json()["script"]["beats"]

    for d in (ML_DEF, SL_DEF):
        i = next(n for n, b in enumerate(beats) if b["kind"] == "definition" and b["say"] == d)         # EXACT book sentence, own beat
        assert beats[i]["src"] == "book"
        card = next(a for a in beats[i]["board"] if a["type"] == "definition")                         # definition card on the board
        assert card["text"] == d and len(card["parts"]) >= 2 and all(p in d for p in card["parts"])
        assert beats[i - 1]["kind"] == "intro", [(b["kind"], b["say"][:25]) for b in beats]             # announced before reading
    i = next(n for n, b in enumerate(beats) if b["say"] == ML_DEF)
    after = [b["kind"] for b in beats[i + 1:]]
    assert "parts" in after and "connect" in after and "example" in after and "check" in after        # explanation came AFTER the reading
    assert after.index("parts") < after.index("connect") < after.index("example") < after.index("check")
    assert any("too thin" in x for x in calls)                                                          # thin explanation was sent back for a retry


def test_definition_phrases_are_whole_exact_substrings():
    from app import teaching
    d = "Machine Learning is a branch of AI in which computers learn patterns from data and make predictions or decisions."
    ph = teaching.phrases(d)
    assert len(ph) >= 3 and all(p in d for p in ph) and all(len(p) >= 8 for p in ph)
    assert "computers learn patterns" in " ".join(ph)
    assert teaching.definition_sentences("Intro text. " + d + " More text.") == [d]
    assert teaching.definition_sentences("This is a sentence that is not a definition at all really.") == []


def test_definition_speech_is_never_transformed():
    from app.hinglish import add_speech
    s = {"beats": [{"say": "Data is the new oil, par it is also big.", "kind": "definition"}, {"say": "Ab dekho.", "kind": "meaning"}], "check": ""}
    add_speech(s, "hinglish")
    assert s["beats"][0]["speech"] == "Data is the new oil, par it is also big."     # exact text untouched
    assert s["beats"][1]["speech"] == "अब देखो."


def test_offline_definition_flow_reads_exactly_and_is_honest():
    h = signup("offdef@example.com")
    did = c.post("/api/documents", headers=h, files={"file": ("ml.txt", DOC)}).json()["id"]
    r = c.post("/api/teach/lesson", headers=h, json={"document_id": did, "topic_id": "t1"}).json()["script"]
    kinds = [b["kind"] for b in r["beats"] if b.get("kind")]
    i = next(n for n, b in enumerate(r["beats"]) if b.get("kind") == "definition")
    assert r["beats"][i]["say"] == ML_DEF and r["beats"][i + 1]["kind"] == "parts" and "check" in kinds
    assert "cannot explain" in r["check"] or "nahi de sakta" in r["check"]          # says plainly what it cannot do without an AI


def test_style_requires_consent():
    h = signup("s@example.com")
    body = {"name": "Prof", "transcript": "Okay so today we learn loops. For example, think of a clock? " * 4, "duration_sec": 30, "consent": False}
    assert c.post("/api/style/analyze", headers=h, json=body).status_code == 400
    body["consent"] = True
    assert c.post("/api/style/analyze", headers=h, json=body).json()["wpm"] > 0


