# PDF understanding & teaching pipeline

## 1. Audit of the old pipeline (run on two real PDFs, see `backend/tests/fixtures.py`)
| Stage | What the old code did | Observed failure |
|---|---|---|
| Extraction (`docparse.extract_pages`) | raw pypdf text, one string per page | header/footer/page numbers stay inside the text |
| Structure (`docparse.build_roadmap`) | regex: any numbered line or ALL-CAPS line (<= 8 words) is a heading | exam paper: **"GUJARAT TECHNOLOGICAL UNIVERSITY"** and **"MCA SEMESTER III - EXAMINATION"** became teachable topics; the real questions were never found. Notes: the page header became a junk "Introduction" topic |
| Definitions | any sentence "X is Y" | "Clustering is the most common example." and "The update rule is w = ..." were treated as definitions |
| Formulas | any short line containing "=" | a whole sentence, or two formulas merged, stored as one "formula" |
| Importance | none. The pronunciation icon used **"any word with 12+ letters"** | random words flagged as difficult/important |
| Lesson prompt | raw topic text + "teach it" | no concept list, no ban on boilerplate, examples unconstrained; nothing checked the result |

## 2. New pipeline (`backend/app/docunderstand.py`)
```
extract -> CLEAN -> classify -> structure -> rank concepts -> teaching plan -> LLM -> QUALITY GATE -> coverage / definition enforcement
```
1. **Clean:** repeated header/footer lines (same text on >= 60% of pages, digits normalised), page numbers, exam/cover metadata (marks, time,
   instructions, university, author, URLs, copyright) are removed and *kept in `analysis.meta`* so the student can see what was ignored. Wrapped lines are
   re-joined into paragraphs, `super-` + `vised` becomes `supervised` (only when the joined word really exists).
2. **Classify:** exam paper / slides / notes.
3. **Structure:** *notes* - scored headings (numbered, "Chapter/Unit", ALL-CAPS, Title Case; question stems, list items and anything ending like a sentence are rejected).
   *Exam paper* - **each question is a topic**; marks are extracted; the concepts a question asks about become the topic's concepts ("Define ML. Explain supervised learning" -> ML, supervised learning).
4. **Concepts (importance-ranked, with evidence):** defined terms (strict definition test), formulas (cut out of their sentence and named), and TF-IDF key phrases.
   Ordinary words are rejected using real word frequency (`wordfreq`), inflected verbs and one-off phrases are dropped.
5. **Difficult words** (speaker icons) = rare/technical words by frequency + the curated technical dictionary + concept words. Never "long word".
6. **Lesson generation:** the model receives the ranked concepts, a list of things it must never speak (the removed boilerplate), the rule that every
   example names the concept it illustrates, and the exact book definitions (read verbatim, then explained). Exam questions are marked *"NEVER read aloud - teach the concept, then outline a model answer for N marks"*.
7. **Quality gate** (`teaching.quality_issues`), run after generation and again after every retry/merge:
   * copied >= 8 consecutive words from the book (exact definitions are the only allowed exception) -> sent back once with the offending sentences;
   * any fragment of removed header/exam text spoken -> sent back, then dropped;
   * an example without an `illustrates` concept, or tied to a concept that is not in the topic -> sent back, then dropped.

Documents uploaded before this pipeline are re-analysed from their stored text the next time they are opened (or via "Re-analyse"). Progress for topics that no longer exist is removed.

## 3. Results on the same two PDFs (automated tests in `tests/test_pipeline.py`)
* exam paper: 12 non-teaching lines set aside; **7 question topics** with marks and concepts; no university/exam topic; "How can it be reduced?" is not a concept.
* notes: exactly 4 topics (2.1-2.4); header and "Page n of 3" removed; "super-/vised" repaired; two separate clean formulas; "Clustering is the most common example" is not a definition;
  none of *model, predicts, predictions, example, data* is a concept; difficult words = *unsupervised, optimisation, overfitting, gradient ...*, not *model/accuracy/machine*.

## 4. Known limits (honest)
* **Scanned PDFs** need Tesseract OCR on the server; without it little text is found (the upload warns). OCR text is cleaned by the same pipeline but is noisier.
* **Layout:** multi-column pages, tables and text inside images are flattened by the PDF text extractor; a table row can be read as a sentence.
* **Definition detection** recognises "X is/are/means/refers to ... " sentences. A definition phrased differently is taught but not read verbatim.
* **Headings in plain PDFs** carry no font information (pypdf gives text only), so unnumbered Title Case lines are a heuristic and can be wrong.
* **Exam papers contain only questions.** The teacher explains the concepts from general knowledge, labelled "extra - not from your book"; there is no book text to ground it. Upload the matching notes for book-grounded teaching.
* **Importance is statistical** (definitions, frequency, rarity, title). It is a ranked guide, not an understanding of the subject; the language model still decides how to teach.
* **The quality gate checks structure, not truth.** It catches copying, boilerplate and unrelated examples. It cannot verify that an explanation is correct - that depends on the model.
* Without an LLM key the offline teacher does the cleaning, structure, key-term board and exact definition reading, but cannot explain or give examples.
