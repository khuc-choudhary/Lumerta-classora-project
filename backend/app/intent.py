"""Understands natural English / Hindi / Hinglish student instructions without fixed command phrases.
Deterministic keyword-groups catch control commands and preference changes instantly (works offline and with
zero LLM latency). Everything else is treated as a question and goes to the LLM with the detected adjustments."""
import re
import unicodedata

# Honorifics / wake words are stripped before matching.
_ADDRESS = re.compile(r"\b(hey|hi|hello|ok|okay)?\s*(aira|nex)\s*(ma'?am|madam|sir)?\b|\b(ma'?am|madam|sir)\b[,]?", re.I)

# The teaching language changes ONLY when the student explicitly asks for it ("ab Hindi mein samjhao", "explain in English").
# Simply asking a question in Hindi / Gujarati / Hinglish never changes it - the teacher keeps the selected language.
LANG_RULES = [  # (pattern naming a language, language) - checked in this order
    (r"(gujarati|ગુજરાતી).*(english|hindi)|(english|hindi).*(gujarati|ગુજરાતી)|\bteeno\b|all\s*three", "mix3"),
    (r"hinglish|hindi\s*(aur|and|\+|&)\s*english|english\s*(aur|and|\+|&)\s*hindi|mix\s*(kar|karke|karo|kro)", "hinglish"),
    (r"gujarati|ગુજરાતી", "gujarati"),
    (r"\bhindi\b|हिंदी|हिन्दी", "hindi"),
    (r"\benglish\b|\bangrezi\b|अंग्रेज़ी|अंग्रेजी", "english"),
]
# ...and the message must actually ASK to be taught / spoken to in it (a verb or "language"/"only"), e.g. not "what is the Hindi word for X?"
_LANG_ASK = re.compile(r"samj|samaj|explain|\bbol|baat|bata|\bbta|btao|padha|teach|speak|talk|reply|answer|jawab|language|bhasha|switch|"
                       r"karo|\bkro\b|kariye|kijiye|please|\bonly\b|\bsirf\b|समझा|बता|बोल|पढ़ा|भाषा|સમજાવ|બોલ|ભાષા", re.I)

_CONFUSED_ENGLISH = re.compile(r"(english|angrezi).*(samajh|samjh|understand).*(nahi|nahin|not|नहीं)", re.I)
# An explicit "don't use (heavy) English" instruction = switch to Hinglish.
_NO_ENGLISH = re.compile(r"(english|angrezi)\s*(mat|na|nahi|nahin|मत)\s*(use|bolo|bol|karo|kro)|heavy\s*english|itni\s*heavy", re.I)

GROUPS = {
    "stop": r"\b(stop|ruk(o|\s*jao)?|bas|chup|quiet|band\s*karo|रुको|बस)\b",
    "pause": r"\b(pause|ek\s*minute|wait|ruko\s*zara|thehro)\b",
    "continue": r"\b(continue|resume|aage\s*(badho|chalo|bolo)|carry\s*on|jaari|चलो)\b",
    "repeat": r"\b(repeat|dobara|phir\s*se|once\s*more|again|explain\s*again|fir\s*se|दोबारा)\b",
    "next": r"\b(next\s*(topic|step|slide)?|agla|aage\s*wala|ab\s*next)\b",
    "previous": r"\b(previous|pichla|peeche|go\s*back|back|pehle\s*wala)\b",
    "slower": r"\b(slow(ly)?|dheere|dhire|धीरे|slowly)\b",
    "faster": r"\b(fast(er)?|jaldi|tez|speed\s*up)\b",
    "simpler": r"(simple|easy|aasan|asaan|aur\s*simple|thoda\s*simple|samajh\s*nahi|samjh\s*nahi|samajh\s*mein\s*nahi|not\s*clear|confus|"
               r"nahi\s*aaya|समझ\s*नहीं)",
    "example": r"\b(example|udaharan|udahran|misal|real[- ]life|real\s*life)\b|उदाहरण",
    "board": r"\b(board|diagram|flowchart|draw|likho|likh\s*ke|bana\s*ke|bana\s*kar|solve\s*karke|step[- ]by[- ]step|write\s*(this|the)?\s*formula|chart|table)\b|बोर्ड",
    "clear_board": r"(board\s*(clear|saaf|साफ)|clear\s*(the\s*)?board|erase)",
    "notes": r"\b(notes?|summary|summarise|summarize)\b",
    "quiz": r"\b(quiz|question\s*pucho|ask\s*me|test\s*me|mcq|sawal\s*pucho)\b",
    "memes": r"\b(meme|funny|trend)\b",
}

LEVELS = [
    (r"very\s*simple|bahut\s*simple|bilkul\s*simple|bachche|bachon|like\s*i'?m\s*(5|five)", "very_simple"),
    (r"beginner|shuru\s*se|basics?", "beginner"),
    (r"exam\s*(level|ke\s*liye|point)|for\s*exam", "exam"),
    (r"technical|in\s*depth|detail(ed)?\s*(me|mein)?|advanced", "technical"),
]


PERS_RULES = [  # (pattern, personality) - only used when the student asks for a STYLE (see _STYLE_ASK)
    (r"funny|mazaa?k|majedar|mazedaar|hasa\w*|comedy|joke", "funny"),
    (r"professor|professional|formal|academic", "professor"),
    (r"strict|sakht|serious", "strict"),
    (r"friendly|dost\w*|pyaa?r\s*se", "friendly"),
    (r"stor(y|ies)|kahani", "storyteller"),
    (r"motivat\w*|josh", "motivational"),
    (r"interactive|question\s*puch\w*\s*ke", "interactive"),
]
_STYLE_ASK = re.compile(r"\b(way|style|tarah|tarike|tareeke|andaaz|andaz|mode|like\s+a|ki\s+tarah|jaise|ban\s*(ke|kar)|bano)\b", re.I)

# Teaching is the DEFAULT. Exact reading happens only when explicitly requested.
NO_READ = re.compile(r"(read|padh|padho|padhna)\s*(mat|na|nahi|nhi|nahin)\b|don'?t\s*read|do\s*not\s*read|dont\s*read|no\s*reading|"
                     r"(mat|na)\s*(read|padho|padh)|sirf\s*samjhao|just\s*explain", re.I)
READ = re.compile(r"\b(read|padho|padh\s*(ke|kar)\s*sunao|padh\s*do|padhkar)\b.*|\bread\s*aloud\b|\bpdf\s*padh", re.I)
BRIEF = re.compile(r"\b(short|chhota|chota|brief|in\s*short|quick(ly)?|sankshep|jaldi\s*me)\b|thoda\s*short", re.I)
DETAIL = re.compile(r"\b(detail(ed)?|vistar\s*se|in\s*depth|deeply|poori\s*explanation|full\s*explanation)\b", re.I)


def _norm(t: str) -> str:
    return unicodedata.normalize("NFKC", t).lower().strip()


def strip_address(text: str) -> str:
    return re.sub(r"\s+", " ", _ADDRESS.sub(" ", text)).strip(" ,.!?")


def analyse(text: str) -> dict:
    raw = text.strip()
    t = _norm(strip_address(raw))
    flags = {name: bool(re.search(p, t, re.I)) for name, p in GROUPS.items()}
    lang = None
    if _LANG_ASK.search(t):                     # explicit request only (see LANG_RULES)
        lang = next((code for pat, code in LANG_RULES if re.search(pat, t, re.I)), None)
        if lang == "english" and _NO_ENGLISH.search(t):
            lang = "hinglish"                   # "heavy English mat use karo"
        elif lang == "english" and _CONFUSED_ENGLISH.search(t):
            lang = None                         # "English samajh nahi aa rahi" alone does not say which language to use
    level = next((lv for pat, lv in LEVELS if re.search(pat, t, re.I)), None)
    personality = next((pc for pat, pc in PERS_RULES if re.search(pat, t, re.I)), None) if _STYLE_ASK.search(t) else None
    if flags["simpler"] and not level:
        level = "very_simple"
    # Pure control command = short utterance dominated by a control keyword.
    words = len(t.split())
    control = None
    for c in ("stop", "pause", "continue", "repeat", "next", "previous", "clear_board"):
        if flags[c] and words <= 6:
            control = c
            break
    if flags["board"] and re.search(r"clear|saaf|साफ|erase", t) and words <= 6:
        control = "clear_board"
    # Compact greeting-only utterances
    only_greeting = words == 0
    no_read = bool(NO_READ.search(t))
    wants_explain = bool(re.search(r"samjh|samajh|explain|teach|batao|bata\b|understand|clarify", t))
    read = bool(READ.search(t)) and not no_read and not wants_explain
    return {
        "read": read, "no_read": no_read, "brief": bool(BRIEF.search(t)), "detail": bool(DETAIL.search(t)),
        "text": raw,
        "clean": strip_address(raw),
        "language": lang,
        "level": level,
        "personality": personality,
        "slower": flags["slower"],
        "faster": flags["faster"],
        "want_board": flags["board"] and control != "clear_board",
        "want_example": flags["example"],
        "want_notes": flags["notes"] and words <= 6,
        "want_quiz": flags["quiz"] and words <= 7,
        "control": control,
        "greeting_only": only_greeting,
        "needs_simplifying": flags["simpler"],
    }
