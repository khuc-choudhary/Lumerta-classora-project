"""Offline demo teacher: no API key needed. It is deliberately limited — a handful of hand-written board lessons
(English + Hinglish) and a generic 'walk through your document excerpt' mode. Real teaching quality comes from
configuring an LLM provider (see .env.example)."""
import re


def _L(prefs, en, hi):
    return en if prefs.get("language") == "english" else hi


def _b(say, emotion="neutral", gesture="none", board=None):
    return {"say": say, "emotion": emotion, "gesture": gesture, "board": board or []}


def _addition(p):
    return {"beats": [
        _b(_L(p, "Okay, let's understand 2 plus 2 using objects on the board.", "Okay, 2 + 2 ko hum board pe objects ke saath samjhenge."), "friendly", "open",
           [{"type": "heading", "text": "2 + 2 = ?", "color": "yellow"}]),
        _b(_L(p, "First, take two objects. Look, here are two circles.", "Pehle do objects lo. Dekho, ye do circles hain."), "neutral", "point",
           [{"type": "dots", "groups": [2], "op": "+", "result": None}]),
        _b(_L(p, "Now add two more objects.", "Ab usme do aur objects add karo."), "neutral", "point",
           [{"type": "dots", "groups": [2, 2], "op": "+", "result": None}]),
        _b(_L(p, "Let's count everything together: one, two, three, four. So the total is four.", "Ab sabko saath me ginte hain: ek, do, teen, char. To total hua char."), "encouraging", "emphasis",
           [{"type": "formula", "text": "2 + 2 = 4", "hl": "4"}]),
    ], "source": "general", "check": _L(p, "Is this part clear? What will 3 + 2 be?", "Ye samajh aaya? Batao, 3 + 2 kitna hoga?")}


def _forloop(p):
    return {"beats": [
        _b(_L(p, "Okay, a for loop repeats a task again and again. Like writing your name five times.", "Okay, for loop ka matlab hai kisi kaam ko baar-baar repeat karna, jaise apna naam paanch baar likhna."), "friendly", "open",
           [{"type": "heading", "text": "Python for loop", "color": "yellow"}]),
        _b(_L(p, "Look at this small program.", "Ab ye chhota sa program dekho."), "neutral", "point",
           [{"type": "code", "lang": "python", "lines": ["for i in range(3):", "    print(i)"], "hl": 1}]),
        _b(_L(p, "Here, i is a variable. It takes the values 0, then 1, then 2.", "Yahan i ek variable hai. Ye pehle 0 banta hai, phir 1, phir 2."), "calm", "point",
           [{"type": "flow", "nodes": ["i = 0", "i = 1", "i = 2", "stop"]}]),
        _b(_L(p, "Each time, print shows the value. So the output is 0, 1, 2.", "Har baar print us value ko dikhata hai. To output aayega 0, 1, 2."), "encouraging", "emphasis",
           [{"type": "output", "lines": ["0", "1", "2"]}]),
    ], "source": "general", "check": _L(p, "Can you tell me what range(5) will print?", "Batao, range(5) kya print karega?")}


def _classreg(p):
    return {"beats": [
        _b(_L(p, "Okay, both are supervised learning, but they predict different things.", "Okay, dono supervised learning hain, lekin predict alag cheez karte hain."), "friendly", "open",
           [{"type": "heading", "text": "Classification vs Regression", "color": "yellow"}]),
        _b(_L(p, "Classification predicts a category. Regression predicts a number.", "Classification category predict karta hai. Regression ek number predict karta hai."), "neutral", "point",
           [{"type": "compare", "left": {"title": "Classification", "items": ["Predicts a category", "Spam / Not spam", "Pass / Fail"]},
             "right": {"title": "Regression", "items": ["Predicts a number", "House price", "Tomorrow's temperature"]}}]),
        _b(_L(p, "So, email spam or not is classification. House price is regression.", "To email spam hai ya nahi, ye classification hai. Ghar ki price regression hai."), "encouraging", "emphasis"),
    ], "source": "general", "check": _L(p, "Is predicting marks out of 100 classification or regression?", "Batao, 100 me se marks predict karna classification hai ya regression?")}


def _normalization(p):
    return {"beats": [
        _b(_L(p, "Imagine a messy wardrobe where everything is thrown in one place. Normalization organises it.", "Socho ek messy wardrobe jisme sab kuch ek jagah pada hai. Normalization use organize karta hai."), "friendly", "open",
           [{"type": "heading", "text": "DBMS Normalization", "color": "yellow"}]),
        _b(_L(p, "Here is an unorganised table. The student's city repeats again and again.", "Ye ek unorganized table hai. Student ka city baar-baar repeat ho raha hai."), "neutral", "point",
           [{"type": "table", "headers": ["StudentID", "Name", "CityName", "CityPin"], "rows": [["1", "Riya", "Surat", "395001"], ["2", "Amit", "Surat", "395001"], ["3", "Neha", "Pune", "411001"]]}]),
        _b(_L(p, "We split it into two related tables. StudentID is the primary key. CityID is the foreign key.", "Hum ise do related tables me todte hain. StudentID primary key hai aur CityID foreign key hai."), "calm", "point",
           [{"type": "flow", "nodes": ["Student(StudentID PK, Name, CityID FK)", "City(CityID PK, CityName, Pin)"]}]),
    ], "source": "general", "check": _L(p, "Why is it better to store the city only once?", "Batao, city sirf ek baar store karna better kyun hai?")}


TOPICS = [
    (r"2\s*\+\s*2|addition|jod", _addition),
    (r"for\s*loop|loop", _forloop),
    (r"classification|regression", _classreg),
    (r"normali[sz]ation|dbms", _normalization),
]


def script(prefs: dict, msg: str, extra: str = "") -> dict:
    low = msg.lower()
    for pat, fn in TOPICS:
        if re.search(pat, low):
            return fn(prefs)
    m = re.search(r"DOCUMENT EXCERPTS:\n(.*?)(?:\n\n|$)", extra, re.S)
    excerpt = (m.group(1) if m else "").strip()
    if excerpt:
        sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", excerpt) if len(s.strip()) > 20][:5]
        beats = [_b(_L(prefs, "Okay, let's go through your material step by step.", "Okay, chalo apne material ko step by step dekhte hain."), "friendly", "open",
                    [{"type": "heading", "text": (msg[:50] or "Your material"), "color": "yellow"}])]
        fr = _FRAME["english" if prefs.get("language") == "english" else "hinglish"]
        for i, s in enumerate(sents):
            beats.append(_b(f"{fr[i % len(fr)]} {s}", "calm", "point", [{"type": "text", "text": s[:110], "color": "white"}]))
        return {"beats": beats, "source": "document",
                "check": _L(prefs, "Is this part clear? (Offline demo mode reads your material; add an LLM key for full explanations.)",
                            "Ye part clear hai? (Offline demo mode material ko padhta hai; poori explanation ke liye LLM key lagao.)")}
    return {"beats": [_b(_L(prefs, "I am in offline demo mode, so I only know a few built-in topics: 2+2, Python for loop, classification vs regression, and normalization. Upload a document, or ask your admin to add an AI provider key for any topic.",
                         "Main abhi offline demo mode me hoon, isliye sirf kuch built-in topics aate hain: 2+2, Python for loop, classification vs regression aur normalization. Koi document upload karo, ya kisi bhi topic ke liye AI provider key add karo."), "friendly", "open")],
            "source": "general", "check": ""}


_FRAME = {
    "english": ["Okay, now look at this point.", "Next, an important idea.", "Pay attention here.", "Let's move to the next part."],
    "hinglish": ["Okay, ab ye point dekho.", "Ab ek important idea samajhte hain.", "Yahan dhyan dena.", "Chalo, next part dekhte hain."],
}


def teach_question(prefs: dict, title: str, concepts: list[dict], marks: int | None) -> dict:
    """Offline handling of an EXAM QUESTION: it is never read aloud; we only say what it asks about and are honest that teaching needs an AI."""
    p = prefs; names = [c["term"] for c in concepts][:4]
    listed = ", ".join(names) if names else title
    return {"beats": [_b(_L(p, f"This is an exam question. It asks about: {listed}. I will not read the question out.", f"Ye exam ka question hai. Isme ye concepts puchhe gaye hain: {listed}. Main question ko padh kar nahi sunaungi."), "friendly", "open",
                        [{"type": "heading", "text": "Concepts asked", "color": "yellow"}] + [{"type": "text", "text": c[:60], "color": "pink"} for c in names[:2]])],
            "source": "general", "mode": "teach", "analysis": {}, "recap": "", "check": _L(p, "To actually teach these concepts and give a model answer, an AI key is needed (offline demo mode cannot do that).",
                                                                                   "In concepts ko samjhane aur model answer dene ke liye AI key chahiye (offline demo mode ye nahi kar sakta).")}


def teach_text(prefs: dict, title: str, text: str, formulas: list[str], defs: list[str], part: int, parts: int, concepts: list[dict] | None = None) -> dict:
    """Offline structured walk-through of the student's own material: key terms and formulas go on the board,
    ideas are introduced with teacher-style framing. It does NOT invent explanations or examples - for real
    explanations with real-life examples an LLM must be configured."""
    p = prefs; fr = _FRAME["english" if p.get("language") == "english" else "hinglish"]
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if 30 < len(s.strip()) < 260]
    beats = [_b(_L(p, f"Okay, let's understand {title}. First I will show the key terms and formulas on the board.", f"Okay, ab hum {title} samjhenge. Pehle board pe key terms aur formulas dekhte hain.") if part == 0
                else _L(p, "Okay, let's continue with the next part of this topic.", "Okay, ab is topic ka agla part dekhte hain."), "friendly", "open",
                [{"type": "heading", "text": title[:60], "color": "yellow"}] if part == 0 else [])]
    from . import teaching
    ordinals = ["First", "Second", "Third", "Fourth", "Fifth"] if p.get("language") == "english" else ["Pehla", "Doosra", "Teesra", "Chautha", "Paanchva"]
    for dsent in teaching.definition_sentences(text, limit=3):
        # Definition -> understanding, as far as possible WITHOUT an AI: exact reading, split into parts on the board, then a check.
        beats.append(teaching._lead(p.get("language", "hinglish")))
        beats.append(teaching.verbatim_beat(dsent))
        for n, ph in enumerate(teaching.phrases(dsent)):
            beats.append({**_b(_L(p, f'{ordinals[n]} part: "{ph}". Think about what this part means.', f'{ordinals[n]} part: "{ph}". Socho, is part ka kya matlab hai.'), "calm", "point",
                               [{"type": "text", "text": f"{n + 1}. {ph}"[:110], "color": ["yellow", "pink", "blue", "green", "white"][n % 5]}]), "kind": "parts", "src": "book"})
        beats.append(teaching._check(p.get("language", "hinglish"), teaching.term_of(dsent)))
    for d in [x for x in defs if not any(x.split(" — ")[0].lower() in b["say"].lower() for b in beats)]:
        term, _, meaning = d.partition(" — ")
        beats.append({**_b(_L(p, f"Important term: {term}. In your book: {meaning}", f"Ye term important hai: {term}. Book ke hisab se: {meaning}"), "serious", "emphasis",
                           [{"type": "text", "text": term[:60], "color": "pink"}]), "kind": "terms", "src": "book"})
    for f in formulas:
        beats.append({**_b(_L(p, "This formula is important. Please note it down.", "Ye formula important hai. Isse note kar lo."), "serious", "point",
                           [{"type": "formula", "text": f[:110], "hl": ""}]), "kind": "technical", "src": "book"})
    terms = [c["term"] for c in (concepts or []) if c["kind"] == "term" and c["importance"] == "high"][:4]
    if terms:                                   # key terms from the importance ranking - NOT arbitrary sentences read aloud
        beats.append({**_b(_L(p, "These are the key terms to remember in this topic.", "Is topic ke ye key terms yaad rakhna."), "serious", "point",
                           [{"type": "text", "text": t[:60], "color": ["pink", "blue", "green", "yellow"][k % 4]} for k, t in enumerate(terms[:3])]), "kind": "terms", "src": "book"})
    return {"beats": beats[:30], "source": "document", "mode": "teach", "analysis": {}, "recap": f"We covered the key terms and ideas of {title}.",
            "check": _L(p, "Is this clear? (Offline demo mode can read each definition exactly and split it into parts, but it cannot explain the meaning or give examples. Add an AI key for that.)",
                        "Ye clear hai? (Offline demo mode definition ko exactly padh kar parts mein todta hai, lekin meaning explain nahi kar sakta aur examples nahi de sakta. Uske liye AI key add karo.)")}


def quiz_from_text(text: str, n: int = 5) -> list[dict]:
    """Cloze-style questions built from the student's own text (no LLM). Honest, simple, but real."""
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if 40 < len(s.strip()) < 220]
    words_pool = list({w for s in sents for w in re.findall(r"[A-Za-z]{6,}", s)})
    out = []
    for s in sents:
        cands = [w for w in re.findall(r"[A-Za-z]{6,}", s)]
        if not cands:
            continue
        ans = max(cands, key=len)
        opts = [ans]
        for w in words_pool:
            if w.lower() != ans.lower() and len(opts) < 4:
                opts.append(w)
        if len(opts) < 3:
            continue
        opts = sorted(opts, key=lambda x: hash(x + s) % 997)
        out.append({"type": "mcq", "q": "Fill in the blank: " + s.replace(ans, "_____", 1), "options": opts,
                    "answer": ans, "explain": f"From your material: \"{s}\""})
        if len(out) >= n:
            break
    return out

