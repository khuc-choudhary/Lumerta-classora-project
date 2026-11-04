"""PDF understanding pipeline tests, run on REAL PDFs (tests/fixtures.py): repeated headers/footers, page numbers, exam metadata."""
import copy
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/pl.db")
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ["LLM_PROVIDER"] = "offline"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import fixtures  # noqa: E402
from app import docparse, docunderstand as du, llm, teaching  # noqa: E402
from app.db import Document, SessionLocal  # noqa: E402
from app.main import app, limiter  # noqa: E402

limiter.enabled = False
c = TestClient(app)


def signup(email):
    r = c.post("/api/auth/signup", json={"name": "T", "email": email, "password": "password123"})
    return {"Authorization": "Bearer " + r.json()["token"]}


def upload(h, name, data):
    r = c.post("/api/documents", headers=h, files={"file": (name, data)})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def exam():
    h = signup("exam@example.com"); up = upload(h, "paper.pdf", fixtures.exam_pdf())
    return h, up, c.get(f"/api/documents/{up['id']}", headers=h).json()


@pytest.fixture(scope="module")
def notes():
    h = signup("notes@example.com"); up = upload(h, "unit2.pdf", fixtures.notes_pdf())
    return h, up, c.get(f"/api/documents/{up['id']}", headers=h).json()


# ---------------------------------------------------------------- exam paper
def test_exam_paper_is_recognised_and_metadata_is_never_a_topic(exam):
    h, up, doc = exam
    assert up["doc_type"] == "exam_paper" and doc["analysis"]["doc_type"] == "exam_paper"
    titles = " | ".join(t["title"] for t in doc["roadmap"])
    for junk in ("UNIVERSITY", "EXAMINATION", "SEMESTER", "Total Marks", "Subject Code", "Instructions", "Attempt all", "Page "):
        assert junk.lower() not in titles.lower(), (junk, titles)
    assert len(doc["roadmap"]) == 7 and all(t["kind"] == "question" for t in doc["roadmap"])
    assert "UNIVERSITY" in " ".join(doc["analysis"]["ignored"]) and any("Total Marks" in x for x in doc["analysis"]["ignored"])   # removed AND reported


def test_exam_questions_become_concepts_with_marks(exam):
    _, _, doc = exam
    q = {t["title"].split(":")[0]: t for t in doc["roadmap"]}
    assert q["Q1(a)"]["marks"] == 7
    assert [c["term"].lower() for c in q["Q1(a)"]["concepts"]] == ["machine learning", "supervised learning"]
    assert [c["term"].lower() for c in q["Q1(b)"]["concepts"]] == ["overfitting"]                  # "How can it be reduced?" is not a concept
    assert "Q3(a) OR" in q and "1nf" in [c["term"].lower() for c in q["Q3(a)"]["concepts"]]


def test_exam_question_lesson_never_reads_the_question(exam, monkeypatch):
    h, up, doc = exam
    seen = []
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "generate_script", lambda prefs, msg, history=None, extra="": seen.append(extra) or {
        "beats": [{"say": "Okay, let's understand overfitting simply.", "emotion": "calm", "gesture": "none", "board": [], "kind": "meaning", "src": "extra", "illustrates": ""}],
        "source": "general", "check": "Clear?", "recap": "", "analysis": {}})
    tid = next(t["id"] for t in doc["roadmap"] if t["title"].startswith("Q1(b)"))
    c.post("/api/teach/lesson", headers=h, json={"document_id": up["id"], "topic_id": tid})
    ex = seen[0]
    assert "EXAM QUESTION" in ex and "NEVER read the question aloud" in ex and "Concepts asked about: overfitting" in ex and "7 marks" in ex
    assert "GUJARAT" not in ex and "UNIVERSITY" not in ex                                          # exam header never reaches the teacher


# ---------------------------------------------------------------- notes / textbook
def test_notes_structure_has_no_junk_topics_and_clean_text(notes):
    h, up, doc = notes
    assert doc["analysis"]["doc_type"] == "notes"
    assert [t["title"] for t in doc["roadmap"]] == ["2.1 Introduction to Machine Learning", "2.2 Types of Machine Learning", "2.3 Model Evaluation", "2.4 Gradient Descent"]
    page1 = doc["pages"][0]
    assert "Prepared by" not in page1 and "Page 1 of 3" not in " ".join(doc["pages"])               # repeated header / page numbers removed
    assert "supervised approach" in page1 and "super-" not in page1                                 # line-wrap hyphenation repaired
    assert "recommendation systems, spam detection" in page1                                         # wrapped lines re-joined into sentences
    assert any("Prepared by" in x for x in doc["analysis"]["ignored"])


def test_concepts_are_definitions_formulas_and_terms_not_random_words(notes):
    _, _, doc = notes
    t = {x["title"].split(" ", 1)[1]: x for x in doc["roadmap"]}
    names = lambda topic: [c["term"].lower() for c in topic["concepts"]]
    assert "machine learning" in names(t["Introduction to Machine Learning"])
    assert {"supervised learning", "unsupervised learning"} <= set(names(t["Types of Machine Learning"]))
    assert "clustering" not in names(t["Types of Machine Learning"])                               # "Clustering is the most common example." is no definition
    for topic in doc["roadmap"]:
        for ordinary in ("model", "predicts", "predictions", "example", "data", "new", "performs"):
            assert ordinary not in names(topic), (ordinary, topic["title"])
    f = t["Model Evaluation"]["formulas"]
    assert f == ["MSE = (1/n) * sum (y - y_pred)^2", "Accuracy = correct predictions / total predictions"]   # two separate, clean formulas
    assert t["Gradient Descent"]["formulas"] == ["w = w - alpha * dL/dw"] and "update rule" in names(t["Gradient Descent"])
    assert all(len(c["term"]) >= 2 for topic in doc["roadmap"] for c in topic["concepts"])         # never a one-letter "concept"


def test_difficult_words_are_technical_not_ordinary(notes):
    d = set(notes[2]["analysis"]["difficult"])
    assert {"unsupervised", "optimisation", "overfitting", "gradient"} <= d
    assert not d & {"model", "accuracy", "learning", "predictions", "important", "following", "example", "machine"}


def test_lesson_prompt_contains_ranked_concepts_and_boilerplate_ban(notes, monkeypatch):
    h, up, doc = notes
    seen = []
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "generate_script", lambda prefs, msg, history=None, extra="": seen.append(extra) or {
        "beats": [{"say": "Okay, let's start.", "emotion": "calm", "gesture": "none", "board": [], "kind": "intro", "src": "book", "illustrates": ""}], "source": "document", "check": "", "recap": "", "analysis": {}})
    tid = next(t["id"] for t in doc["roadmap"] if t["title"].startswith("2.4"))
    r = c.post("/api/teach/lesson", headers=h, json={"document_id": up["id"], "topic_id": tid}).json()
    ex = seen[0]
    assert "KEY CONCEPTS" in ex and "Gradient descent" in ex and "learning rate" in ex and "NEVER SPEAK" in ex and "Prepared by Prof" in ex and "illustrates" in ex
    assert "Page 3 of 3" not in ex.split("DOCUMENT EXCERPTS:")[1]                                      # excerpt handed to the model is clean text
    assert r["concepts"][0].lower() == "gradient descent"


# ---------------------------------------------------------------- quality gate
def test_quality_gate_rejects_reading_boilerplate_and_unrelated_examples(notes, monkeypatch):
    h, up, doc = notes
    calls = []
    book = "Overfitting is a situation where a model learns noise in the training data and performs poorly on new data."
    bad = {"beats": [
        {"say": "A model learns noise in the training data and performs poorly on new data, as the book says.", "emotion": "calm", "gesture": "none", "board": [], "kind": "meaning", "src": "book", "illustrates": ""},
        {"say": "This paper is prepared by Prof. A. Shah, page one.", "emotion": "calm", "gesture": "none", "board": [], "kind": "meaning", "src": "book", "illustrates": ""},
        {"say": "Imagine a cricket match where the captain wins the toss.", "emotion": "calm", "gesture": "none", "board": [], "kind": "example", "src": "extra", "illustrates": "cricket"}],
        "source": "document", "check": "", "recap": "", "analysis": {}}
    good = {"beats": [{"say": "Think of a student who memorises last year's answers word by word.", "emotion": "calm", "gesture": "none", "board": [], "kind": "example", "src": "extra", "illustrates": "Overfitting"}],
            "source": "document", "check": "", "recap": "", "analysis": {}}

    def fake(prefs, msg, history=None, extra=""):
        calls.append(extra)
        return copy.deepcopy(good if "PROBLEMS IN YOUR PREVIOUS LESSON" in extra else bad)
    monkeypatch.setattr(llm, "configured", lambda: True); monkeypatch.setattr(llm, "generate_script", fake)
    tid = next(t["id"] for t in doc["roadmap"] if t["title"].startswith("2.3"))
    r = c.post("/api/teach/lesson", headers=h, json={"document_id": up["id"], "topic_id": tid}).json()
    assert r["quality_retry"] is True and any("PROBLEMS" in x and "COPIED" in x and "boilerplate" in x and "unrelated" in x for x in calls)
    says = " ".join(b["say"] for b in r["script"]["beats"])
    assert "cricket" not in says and "Prof. A. Shah" not in says            # unrelated example + boilerplate gone, even when re-added by a later retry
    assert any(b.get("illustrates") == "Overfitting" for b in r["script"]["beats"])


def test_quality_gate_drops_what_the_retry_cannot_fix():
    def lesson():
        return {"beats": [{"say": "This sheet is prepared by Prof. A. Shah for you.", "kind": "meaning", "board": []},
                          {"say": "Imagine a cricket match.", "kind": "example", "illustrates": "cricket", "board": []},
                          {"say": "Gradient descent lowers the loss step by step.", "kind": "meaning", "board": []}]}
    header = ["Machine Learning Notes - Unit 2 | Prepared by Prof. A. Shah"]
    qi = teaching.quality_issues(lesson(), "", header, ["gradient descent"], "2.4 Gradient Descent")
    assert qi["meta"] == [0] and qi["bad_examples"] == [1]              # header only PARTLY quoted ("prepared by Prof. A. Shah"): still caught
    assert teaching.quality_issues(lesson(), "", ["Total Marks: 70"], ["gradient descent"], "2.4 Gradient Descent")["meta"] == []   # unrelated boilerplate: no false alarm
    script = lesson()
    assert teaching.drop_bad(script, qi) == 2 and [b["say"] for b in script["beats"]] == ["Gradient descent lowers the loss step by step."]


def test_exact_definitions_are_allowed_but_paragraph_reading_is_not():
    src = "Overfitting is a situation where a model learns noise in the training data and performs poorly on new data."
    s = {"beats": [{"say": src, "kind": "definition", "board": []}, {"say": src, "kind": "meaning", "board": []}]}
    assert teaching.quality_issues(s, src, [], ["overfitting"], "x")["copied"] == [1]


# ---------------------------------------------------------------- unit-level
def test_definition_filter_rejects_non_definitions():
    assert teaching.definition_sentences("Clustering is the most common example of this kind of task.") == []
    assert teaching.definition_sentences("The update rule is w = w - alpha * dL/dw in every step of training.") == []
    assert teaching.definition_sentences("Overfitting is a situation where a model learns noise in the training data.") != []


def test_header_footer_removal_needs_repetition_so_real_content_survives():
    pages = ["Chapter heading\nReal content line one is long enough to be a sentence.", "Another page with different first line.\nSecond page content continues here."]
    clean, removed = du.clean_pages(pages)
    assert "Real content line one" in clean[0] and "Second page content" in clean[1] and removed == []


def test_old_documents_are_reanalysed_on_next_open():
    h = signup("old@example.com")
    pages, _ = docparse.extract_pages(".pdf", fixtures.exam_pdf())
    old = docparse.build_roadmap(pages)                                   # what the OLD pipeline produced (university name as a topic!)
    assert any("UNIVERSITY" in t["title"] for t in old)
    with SessionLocal() as db:
        uid = c.get("/api/me", headers=h).json()["id"]
        d = Document(user_id=uid, title="old", filename="old.pdf", pages=pages, roadmap=old, analysis={})
        db.add(d); db.commit(); did = d.id
    doc = c.get(f"/api/documents/{did}", headers=h).json()
    assert doc["analysis"]["doc_type"] == "exam_paper" and not any("UNIVERSITY" in t["title"] for t in doc["roadmap"]) and len(doc["roadmap"]) == 7
