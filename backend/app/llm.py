"""LLM provider layer + lesson-script contract.

Every teaching response is a *script*:
  {"beats":[{"say": str, "emotion": str, "gesture": str, "board":[BoardAction,...]}], "source": "document|general|mixed", "check": str}
The frontend speaks each beat while revealing that beat's board actions. Board actions are validated
here (whitelist + size caps) so a model can never push arbitrary content to the client."""
import json
import re

import httpx

from .config import settings

EMOTIONS = {"neutral", "excited", "calm", "serious", "encouraging", "friendly", "curious"}
GESTURES = {"none", "point", "open", "nod", "think", "emphasis"}
KINDS = {"intro", "meaning", "terms", "example", "technical", "practical", "recap", "check", "read", "definition", "parts", "connect"}
BOARD_TYPES = {"heading", "text", "definition", "formula", "dots", "table", "code", "flow", "compare", "shape", "output", "clear", "newpage"}

PERSONALITIES = {   # HOW the teacher talks. Each one must make the lesson sound clearly different.
    "friendly": "Warm, patient elder-sibling tone. Encourage often ('Very good!', 'Don't worry, this is easy'), use everyday examples from student life.",
    "strict": "Firm and focused, never harsh. Short, direct sentences, no jokes or chit-chat. Point out exactly what to remember for the exam and expect attention ('Note this point carefully.').",
    "funny": "Playful and humorous. Put a light joke, funny comparison or silly everyday scenario in MOST beats (e.g. compare overfitting to a student who memorised the answer key), while every concept stays correct and clear.",
    "motivational": "High energy and confidence-building. Celebrate progress, tell the student they can do it, link topics to future jobs and goals.",
    "professor": "Formal university professor. Precise academic vocabulary, structured 'firstly / secondly / therefore' flow, correct terminology, calm authority, no slang or jokes.",
    "beginner": "Extremely gentle. Assume zero background, one tiny idea per beat, explain every word, reassure often.",
    "interactive": "Conversation, not lecture: ask the student a small question in most beats ('What do you think happens next?') before explaining.",
    "storyteller": "Teach through a short running story or scenario with characters, then connect each part of the story to the concept.",
}
LANG_STYLE = {
    "english": "Simple everyday Indian English. Short sentences. No heavy vocabulary.",
    "hindi": "Everyday SPOKEN Hindi (bol-chaal ki Hindi) in Devanagari, the way a teacher in an Indian college actually talks - NOT pure/textbook (shuddh) Hindi. Keep common English words in English.",
    "hinglish": "Natural Hinglish in Roman script: Hindi sentence flow with English technical terms (e.g. 'Machine Learning ka simple meaning hai...').",
    "gujarati": "Natural spoken Gujarati in Gujarati script, keeping common English technical terms.",
    "mix3": "A natural mix of English, Hindi and Gujarati as an Indian teacher would speak.",
    "auto": "Mirror the language mix the student used most recently.",
}
LEVELS = {
    "very_simple": "Very simple: tiny steps, everyday objects, explain every difficult word first.",
    "beginner": "Beginner: no assumed background, one idea per sentence.",
    "normal": "Normal classroom level.",
    "technical": "Technical: precise terminology, edge cases.",
    "exam": "Exam level: definitions, key points, how to write it in answers.",
}

LANG_RULE = {   # final, strict wording rule for the 'say' text (the examples in TEACHING_RULES are Hinglish; this overrides them)
    "english": "Write EVERY 'say' text in simple English ONLY. Not a single Hindi/Hinglish word (no 'ab', 'chalo', 'samjhte hain', 'hai'). The Hinglish phrases quoted above only show the tone: use English equivalents like 'Okay, now let's understand this'. Leave 'speech' empty.",
    "hindi": "Write EVERY 'say' text in easy everyday spoken Hindi (Devanagari script) - the Hindi people really speak, NOT pure/textbook Hindi. Keep the English words Indians normally use in English letters: all technical terms (Machine Learning, data, model, algorithm, training) and everyday words like example, simple, important, point, process, result, problem, step, question, answer, topic. NEVER use heavy Sanskrit words: say 'AI' not 'कृत्रिम बुद्धि', 'example' not 'उदाहरण', 'data' not 'आँकड़े', 'important' not 'महत्वपूर्ण', 'process' not 'प्रक्रिया', 'simple' not 'सरल'. Example: 'तो Machine Learning में computer data से patterns सीखता है, बिल्कुल simple है.'",
    "hinglish": "Write EVERY 'say' text in Roman Hinglish (Hindi sentence flow, English technical terms). Not pure English and not Devanagari in 'say'.",
    "gujarati": "Write EVERY 'say' text in Gujarati (Gujarati script). English technical terms may stay in English. No Hindi or Hinglish sentences.",
    "mix3": "Mix English, Hindi and Gujarati naturally in the 'say' text, as an Ahmedabad teacher would.",
    "auto": "Reply in the same language/mix the student used in their latest message.",
}

SCHEMA_DOC = """Return ONLY JSON:
{"analysis":{"main_concept":"","key_terms":["difficult word/term"],"covered_points":["every definition, formula, condition and key point of the material that this lesson will teach"],"needs_visual":"where a diagram/example/calculation will help"},
 "beats":[{"kind":"intro|definition|parts|connect|meaning|terms|example|technical|practical|check|recap","src":"book|extra","illustrates":"examples only: the key concept this example explains","say":"spoken text for ONE short idea (1-3 sentences)","speech":"ONLY for Hindi/Hinglish/Gujarati mixes: the SAME sentence for the voice, with every Hindi word in Devanagari (e.g. say 'Chalo ab dekhte hain' -> speech 'चलो अब देखते हैं'); English technical terms stay in English letters","emotion":"neutral|excited|calm|serious|encouraging|friendly|curious","gesture":"none|point|open|nod|think|emphasis","board":[actions]}],
 "source":"document|general|mixed","recap":"one-sentence summary of what this lesson covered","check":"one short question to confirm understanding"}
Write "analysis" FIRST (plan before you teach). src="book" means the idea comes from the student's material; src="extra" means your own real-life/practical example or analogy.
Board actions (use only when it helps; reveal progressively across beats, never one giant board):
 {"type":"heading","text":""} {"type":"text","text":"","color":"white|yellow|pink|blue|green"} {"type":"formula","text":"a = b + c","hl":"optional substring to highlight"}
 {"type":"dots","groups":[2,2],"op":"+","result":4}   (object counting)
 {"type":"table","headers":[""],"rows":[[""]]}   {"type":"code","lang":"python","lines":[""],"hl":1-based line to highlight}
 {"type":"definition","text":"exact definition sentence","parts":["phrase from it"]}   {"type":"flow","nodes":["A","B","C"]}   {"type":"compare","left":{"title":"","items":[""]},"right":{"title":"","items":[""]}}
 {"type":"shape","shape":"circle|rect|arrow","label":""}   {"type":"output","lines":[""]}   {"type":"clear"}   {"type":"newpage"}
Max 30 beats, max 3 board actions per beat."""

TEACHING_RULES = """TEACHING MODE (default) - you are a TEACHER, never a PDF reader or audiobook:
1. First understand the whole material: main concept, difficult terms, how the points relate, where an example or diagram is needed. Put this plan in "analysis".
2. NEVER read paragraphs, headings or bullets as written. Do not repeat textbook sentences. Re-explain every idea in your own simple words, the way an Indian teacher talks in class ("Okay, ab ye samjhte hain", "Iska simple meaning ye hai...", "Ab ek real-life example dekhte hain", "Toh yahan actually kya ho raha hai?", "Ab ye point samajh aaya?").
3. Flow (adapt it, do not follow it mechanically; short topics need fewer steps): introduce the topic, simple meaning, explain difficult terms, a relevant real-life example, how it technically works, a practical example (code line by line with output, a solved numerical, a table or diagram), use the board when it helps, then ask one small understanding question.
4. COVER EVERYTHING: every definition, formula, condition and key concept in the material must be taught. Never skip them or change their meaning. Keep original technical terms but explain them simply. Put formulas on the board exactly as written in the material.
5. Examples must be relevant to THIS concept (ML: YouTube recommendations, spam detection, house price; DBMS: student records, shopping data, library; Maths: solve step by step; Networking: real internet examples; programming: code line by line plus output). Mark them src="extra" and say aloud that it is an extra example, not from the book.
6. Continuity: connect to what was already explained and to the page the student is viewing; do not repeat covered points unless asked; do not jump between unrelated concepts. End every lesson with a short recap beat (kind="recap") before the check question.
7. Exact reading is NOT your job unless the student asked you to read aloud (that is handled separately).
8. DEFINITION -> UNDERSTANDING METHOD. This is the ONE exception to "never read the book": for every definition, technical statement or formula in the material, do ALL of these IN ORDER and finish them before starting the next definition:
   a. A short lead-in beat (kind "intro"): say that you will first read the book's exact definition.
   b. ONE beat kind "definition", src "book": "say" is the book's sentence WORD FOR WORD. No paraphrase, no added or removed words. Its board action: {"type":"definition","text":"<same sentence>","parts":["phrase 1","phrase 2",...]} where each part is a meaningful phrase copied from the sentence (never single letters).
   c. Beats kind "parts": explain EACH phrase in simple language ("'a branch of AI' means ..."). Start with a short line saying this is YOUR explanation, not the book's.
   d. One beat kind "connect": how the parts combine into the whole concept.
   e. One beat kind "example", src "extra": a real-life example that directly matches THIS definition (not generic, not complicated); say it is an extra example. Show it on the board when it helps (flow / compare / table / shape actions).
   f. One beat kind "check": ONE simple question for the student.
   g. One beat kind "recap": the concept in 1-2 easy sentences.
   Model of the explanation, for "Machine Learning is a branch of AI in which computers learn patterns from data and make predictions or decisions": 'Okay, let's understand this definition in simple language. First, "a branch of AI" means Machine Learning is one part of Artificial Intelligence. Now, "computers learn patterns from data" means we give data to a computer and it finds common patterns. For example, if we give 1,000 pictures of cats and dogs, it learns how they look different. Now when we show a new picture, it can predict cat or dog. So simple meaning: Machine Learning mein computer data se patterns seekhta hai aur unki help se prediction ya decision leta hai.'
   For a formula: read it exactly, put it on the board, explain every symbol, then a small worked numerical example.
   If the student says they did not understand, explain the SAME definition again with a DIFFERENT example or a simpler analogy; never change the book's wording."""


def system_prompt(prefs: dict, extra: str = "") -> str:
    name = prefs.get("teacher_name") or ("AIRA" if prefs.get("teacher", "aira") == "aira" else "NEX")
    female = prefs.get("teacher", "aira") == "aira"
    title = "Ma'am" if female else "Sir"
    pers = PERSONALITIES.get(prefs.get("personality", "friendly"), PERSONALITIES["friendly"])
    return f"""You are {name}, a human-like Indian {'female' if female else 'male'} AI teacher inside LUMETRA CLASSORA. Students call you {name} {title}.
Personality: {pers}.
Language: {LANG_STYLE.get(prefs.get('language', 'hinglish'), LANG_STYLE['hinglish'])}
Level: {LEVELS.get(prefs.get('level', 'normal'))}
Speak like a real classroom teacher: "Okay, let's understand this", "Is this part clear?", "Don't worry, I'll explain again". Never robotic, no fixed script feel.
Explain difficult words in simple language before reusing them. If the student struggles, explain differently (new example, analogy, smaller steps) instead of repeating.
{'Use a relatable meme or trend reference only if it genuinely helps and is harmless.' if prefs.get('memes') else 'Do not use memes.'}
{TEACHING_RULES}
If document excerpts are given, ground the answer in them and NEVER invent document content; set source to "document". Anything beyond the excerpts must be said out loud as "this is extra, not from your material" and source "mixed" or "general".
{extra}
{SCHEMA_DOC}

STYLE RULES - HIGHEST PRIORITY, they override every example above:
1. LANGUAGE: {LANG_RULE.get(prefs.get('language', 'hinglish'), LANG_RULE['hinglish'])}{'' if prefs.get('language') == 'auto' else ' The student may write or speak to you in ANY language (Hindi, Gujarati, Hinglish, English...): understand it, but ALWAYS answer in this selected language. Switch only if the student explicitly asks you to teach in another language.'}
2. PERSONALITY "{prefs.get('personality', 'friendly')}": {pers} The student must clearly FEEL this personality in the wording of every beat.
3. LEVEL: {LEVELS.get(prefs.get('level', 'normal'))}"""


# ---------- sanitising ----------
def _s(v, n=200):
    return str(v)[:n] if v is not None else ""


def sanitize_action(a: dict) -> dict | None:
    if not isinstance(a, dict) or a.get("type") not in BOARD_TYPES:
        return None
    t = a["type"]
    if t in ("heading", "text"):
        return {"type": t, "text": _s(a.get("text"), 160), "color": a.get("color") if a.get("color") in {"white", "yellow", "pink", "blue", "green"} else "white"}
    if t == "formula":
        return {"type": t, "text": _s(a.get("text"), 120), "hl": _s(a.get("hl"), 60)}
    if t == "definition":
        return {"type": t, "text": _s(a.get("text"), 340), "parts": [_s(x, 100) for x in (a.get("parts") or [])[:6] if isinstance(x, str)]}
    if t == "dots":
        g = [max(0, min(int(x), 12)) for x in (a.get("groups") or [])[:4] if str(x).lstrip("-").isdigit()]
        return {"type": t, "groups": g, "op": _s(a.get("op"), 2) or "+", "result": a.get("result") if isinstance(a.get("result"), (int, float)) else None}
    if t == "table":
        h = [_s(x, 30) for x in (a.get("headers") or [])[:6]]
        r = [[_s(c, 30) for c in row[:6]] for row in (a.get("rows") or [])[:8] if isinstance(row, list)]
        return {"type": t, "headers": h, "rows": r}
    if t == "code":
        return {"type": t, "lang": _s(a.get("lang"), 12), "lines": [_s(x, 80) for x in (a.get("lines") or [])[:14]],
                "hl": a.get("hl") if isinstance(a.get("hl"), int) else None}
    if t == "flow":
        return {"type": t, "nodes": [_s(x, 24) for x in (a.get("nodes") or [])[:6]]}
    if t == "compare":
        def side(s):
            s = s if isinstance(s, dict) else {}
            return {"title": _s(s.get("title"), 30), "items": [_s(x, 40) for x in (s.get("items") or [])[:5]]}
        return {"type": t, "left": side(a.get("left")), "right": side(a.get("right"))}
    if t == "shape":
        return {"type": t, "shape": a.get("shape") if a.get("shape") in {"circle", "rect", "arrow"} else "rect", "label": _s(a.get("label"), 30)}
    if t == "output":
        return {"type": t, "lines": [_s(x, 80) for x in (a.get("lines") or [])[:6]]}
    return {"type": t}


def sanitize_script(raw: dict) -> dict:
    beats = []
    for b in (raw.get("beats") or [])[:30]:
        say = _s(b.get("say"), 600).strip()
        if not say:
            continue
        acts = [x for x in (sanitize_action(a) for a in (b.get("board") or [])[:3]) if x]
        beats.append({"say": say, "emotion": b.get("emotion") if b.get("emotion") in EMOTIONS else "neutral",
                      "gesture": b.get("gesture") if b.get("gesture") in GESTURES else "none", "board": acts,
                      "speech": _s(b.get("speech"), 900).strip(), "illustrates": _s(b.get("illustrates"), 80).strip(),
                      "kind": b.get("kind") if b.get("kind") in KINDS else "meaning", "src": "extra" if b.get("src") == "extra" else "book"})
    if not beats:
        raise ValueError("empty script")
    src = raw.get("source") if raw.get("source") in {"document", "general", "mixed"} else "general"
    an = raw.get("analysis") if isinstance(raw.get("analysis"), dict) else {}
    return {"beats": beats, "source": src, "check": _s(raw.get("check"), 200), "recap": _s(raw.get("recap"), 300),
            "analysis": {"main_concept": _s(an.get("main_concept"), 200), "covered_points": [_s(x, 160) for x in (an.get("covered_points") or [])[:30]]}}


def parse_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON in model output")
    return json.loads(m.group(0))


# ---------- providers ----------
class LLMError(Exception):
    pass


def configured() -> bool:
    p = settings.llm_provider
    return (p == "anthropic" and bool(settings.anthropic_api_key)) or (p == "openai" and bool(settings.openai_api_key))


def _call(system: str, messages: list[dict], max_tokens: int = 2500) -> str:
    """Calls the provider; when it is temporarily busy (HTTP 429/503) waits and retries twice before giving up."""
    import time
    for wait in (3, 8, None):
        try:
            return _call_once(system, messages, max_tokens)
        except LLMError as e:
            if wait is None or not getattr(e, "busy", False):
                raise
            time.sleep(wait)


def _call_once(system: str, messages: list[dict], max_tokens: int = 2500) -> str:
    p = settings.llm_provider
    try:
        if p == "anthropic":
            r = httpx.post("https://api.anthropic.com/v1/messages", timeout=90,
                           headers={"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01"},
                           json={"model": settings.llm_model or "claude-sonnet-5-5", "max_tokens": max_tokens,
                                 "system": system, "messages": messages})
            r.raise_for_status()
            return r.json()["content"][0]["text"]
        if p == "openai":
            r = httpx.post(f"{settings.openai_base_url.rstrip('/')}/chat/completions", timeout=90,
                           headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                           json={"model": settings.llm_model or "gpt-4o-mini", "max_tokens": max_tokens,
                                 "messages": [{"role": "system", "content": system}, *messages]})
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as e:      # the provider answered with an error: show its status and reason (never the key)
        try:
            body = e.response.json()
            body = body[0] if isinstance(body, list) and body else body
            detail = (body.get("error") or {}).get("message") if isinstance(body, dict) else None
        except ValueError:
            detail = None
        err = LLMError(f"The AI provider refused the request (HTTP {e.response.status_code}): {(detail or e.response.text or '')[:300]}")
        err.busy = e.response.status_code in (429, 503)
        raise err
    except httpx.HTTPError as e:
        raise LLMError(f"The AI provider could not be reached ({e.__class__.__name__}). Check your API key and network.")
    raise LLMError("No LLM configured")


def generate_script(prefs: dict, user_msg: str, history: list[dict] | None = None, extra: str = "") -> dict:
    """Returns a validated script. Raises LLMError if provider fails. Falls back to offline teacher when unconfigured."""
    from . import offline
    if not configured():
        return offline.script(prefs, user_msg, extra)
    msgs = [*(history or [])[-8:], {"role": "user", "content": user_msg}]
    last_err = None
    for _ in range(2):  # one retry on malformed JSON
        out = _call(system_prompt(prefs, extra), msgs, 7000)
        try:
            return sanitize_script(parse_json(out))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            last_err = e
            msgs = [*msgs, {"role": "assistant", "content": out}, {"role": "user", "content": "That was not valid JSON for the schema. Return ONLY the JSON."}]
    raise LLMError(f"The AI returned an unreadable lesson ({last_err}). Please try again.")


def generate_json(system: str, user: str, max_tokens: int = 3000):
    out = _call(system, [{"role": "user", "content": user}], max_tokens)
    return parse_json(out) if "{" in out else json.loads(out)

