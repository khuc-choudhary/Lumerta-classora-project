"""Pronunciation engine: word lookup, IPA, syllables and stress, language segmentation.

Lookup order for an English word (first hit wins, and the SOURCE is always reported - nothing is invented):
  1. user override        (student's own correction)           status "override"
  2. curated technical    (pron_data.CURATED)                   status "curated"  (not lexicographer-reviewed)
  3. CMU Pronouncing Dict (open dictionary, ~126k words)        status "cmudict"  (General American reference)
  4. composed from two CMU words (e.g. hyper+parameter)         status "composed" (NOT verified)
  5. nothing reliable found                                     status "unknown"  (no phonetics are shown or invented)
Hindi words are never given IPA by guesswork: they are converted to Devanagari so a Hindi voice reads them natively."""
import functools
import re

import cmudict
import pyphen

from . import pron_data
from .hinglish import _MAP as HI_MAP

ARPA = {"AA": "ɑː", "AE": "æ", "AO": "ɔː", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ", "EY": "eɪ", "IH": "ɪ", "IY": "iː", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ", "UW": "uː",
        "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
        "R": "r", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ"}
VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
ONSET2 = {("P", "L"), ("B", "L"), ("K", "L"), ("G", "L"), ("F", "L"), ("S", "L"), ("P", "R"), ("B", "R"), ("T", "R"), ("D", "R"), ("K", "R"), ("G", "R"), ("F", "R"),
          ("TH", "R"), ("SH", "R"), ("T", "W"), ("D", "W"), ("K", "W"), ("G", "W"), ("S", "W"), ("TH", "W"), ("S", "P"), ("S", "T"), ("S", "K"), ("S", "M"), ("S", "N"),
          ("S", "F"), ("HH", "Y"), ("P", "Y"), ("B", "Y"), ("T", "Y"), ("D", "Y"), ("K", "Y"), ("G", "Y"), ("M", "Y"), ("N", "Y"), ("F", "Y"), ("V", "Y"), ("L", "Y"), ("S", "Y")}
ONSET3 = {("S", "P", "L"), ("S", "P", "R"), ("S", "T", "R"), ("S", "K", "R"), ("S", "K", "W"), ("S", "K", "L"), ("S", "P", "Y"), ("S", "T", "Y"), ("S", "K", "Y")}

_hyph = pyphen.Pyphen(lang="en_US")


@functools.lru_cache(maxsize=1)
def _cmu() -> dict:
    return cmudict.dict()


def _ipa_phone(p: str) -> str:
    base, stress = re.match(r"([A-Z]+)(\d?)", p).groups()
    if base == "AH":
        return "ə" if stress in ("", "0") else "ʌ"
    if base == "ER":
        return "ər" if stress in ("", "0") else "ɜːr"
    return ARPA[base]


def syllabify(phones: list[str]) -> list[dict]:
    """Splits ARPAbet phones into syllables (maximal-onset principle). Returns [{ipa, stress}]."""
    vi = [i for i, p in enumerate(phones) if re.sub(r"\d", "", p) in VOWELS]
    if not vi:
        return [{"ipa": "".join(_ipa_phone(p) for p in phones), "stress": "none"}]
    sylls = []
    for n, v in enumerate(vi):
        start = 0 if n == 0 else prev_end
        nxt = vi[n + 1] if n + 1 < len(vi) else len(phones)
        if n + 1 < len(vi):
            cluster = phones[v + 1:nxt]
            k = 0
            for size in (3, 2, 1):
                if len(cluster) >= size:
                    tail = tuple(re.sub(r"\d", "", c) for c in cluster[-size:])
                    if size == 3 and tail in ONSET3 or size == 2 and tail in ONSET2 or size == 1 and tail != ("NG",):
                        k = size
                        break
            end = nxt - k
        else:
            end = len(phones)
        seg = phones[start:end]
        prev_end = end
        stress = re.search(r"\d", phones[v]).group() if re.search(r"\d", phones[v]) else "0"
        sylls.append({"ipa": "".join(_ipa_phone(p) for p in seg), "stress": {"1": "primary", "2": "secondary"}.get(stress, "none")})
    return sylls


def _mark(sylls: list[dict]) -> str:
    return ".".join(("ˈ" if s["stress"] == "primary" else "ˌ" if s["stress"] == "secondary" else "") + s["ipa"] for s in sylls)


def _from_ipa(ipa: str) -> list[dict]:
    out = []
    for part in ipa.split("."):
        st = "primary" if part.startswith("ˈ") else "secondary" if part.startswith("ˌ") else "none"
        out.append({"ipa": part.lstrip("ˈˌ"), "stress": st})
    return out


def _compose(word: str) -> list[str] | None:
    d = _cmu()
    for i in range(3, len(word) - 2):
        a, b = word[:i], word[i:]
        if a in d and b in d:
            pa, pb = list(d[a][0]), list(d[b][0])
            pb = [re.sub(r"1", "2", p) for p in pb]            # second part's primary stress becomes secondary
            return pa + pb
    return None


def lookup(word: str, overrides: dict[str, str] | None = None) -> dict:
    w = word.lower().strip("'-")
    base = {"word": word}
    if overrides and w in overrides:
        s = _from_ipa(overrides[w]); status, note = "override", "Your own correction."
    elif w in pron_data.CURATED:
        s = _from_ipa(pron_data.CURATED[w])
        status = "curated"; note = "Curated technical/brand pronunciation (not lexicographer-reviewed)."
        if pron_data.CURATED_SOURCE.get(w) == "brand":
            note = "Product name pronunciation."
    elif w in _cmu():
        entry = _cmu()[w]
        s = syllabify(entry[0]); status = "cmudict"
        note = "CMU Pronouncing Dictionary (General American reference; the Indian English voice applies its own accent)."
        if len({tuple(e) for e in entry}) > 1:
            note += f" {len(entry)} accepted pronunciations exist (e.g. by meaning); showing the first."
            base["alternatives"] = [_mark(syllabify(e)) for e in entry[1:4]]
    elif (c := _compose(w)):
        s = syllabify(c); status = "composed"; note = "Built by joining two dictionary words. NOT verified - listen and correct it if wrong."
    else:
        return {**base, "status": "unknown", "ipa": None, "syllables": [], "syllable_count": 0, "stressed": None,
                "spelling_syllables": _hyph.inserted(word), "note": "No reliable pronunciation found, so none is shown. The voice reads it with its default rules; add your own correction if needed."}
    stressed = next((i for i, x in enumerate(s) if x["stress"] == "primary"), None)
    return {**base, "status": status, "ipa": _mark(s), "syllables": s, "syllable_count": len(s), "stressed": stressed,
            "spelling_syllables": _hyph.inserted(word), "note": note}


# ---------- language segmentation ----------
_TOKEN = re.compile(r"[ऀ-ॿ]+|[A-Za-z][A-Za-z'\-]*|\d+|\s+|[^\sA-Za-zऀ-ॿ\d]+")


def token_lang(tok: str) -> str | None:
    if re.match(r"[ऀ-ॿ]", tok):
        return "hi"
    if re.match(r"[A-Za-z]", tok):
        return "hi" if tok.lower() in HI_MAP else "en"
    return None


def segment(text: str) -> list[dict]:
    """Splits mixed text into language runs. Punctuation/space/digits join the run they follow, so phrases
    like 'Machine Learning' stay together and no artificial gaps are created inside a run."""
    runs: list[dict] = []
    pending = ""
    for tok in _TOKEN.findall(text):
        lang = token_lang(tok)
        if lang is None:
            if runs:
                runs[-1]["text"] += tok
            else:
                pending += tok
            continue
        if runs and runs[-1]["lang"] == lang:
            runs[-1]["text"] += tok
        else:
            runs.append({"lang": lang, "text": pending + tok})
        pending = ""
    if pending and runs:
        runs[-1]["text"] += pending
    if not runs and text.strip():
        runs = [{"lang": "en", "text": text}]
    for r in runs:                                       # Roman Hindi -> Devanagari for the Hindi voice
        if r["lang"] == "hi":
            from .hinglish import speechify
            r["speech"] = speechify(r["text"])
        else:
            r["speech"] = r["text"]
    return runs


def is_acronym(tok: str) -> bool:
    return tok.isupper() and 2 <= len(tok) <= 6 and tok.lower() in pron_data.ACRONYMS


def analyze(text: str, overrides: dict[str, str] | None = None) -> dict:
    words = []
    for tok in _TOKEN.findall(text):
        lang = token_lang(tok)
        if lang == "hi":
            from .hinglish import speechify
            words.append({"word": tok, "lang": "hi", "status": "hindi", "ipa": None, "syllables": [], "syllable_count": 0, "stressed": None,
                          "devanagari": speechify(tok), "note": "Hindi: read by a Hindi voice from Devanagari. No phonetic guess is shown."})
        elif lang == "en":
            if is_acronym(tok):
                words.append({"word": tok, "lang": "en", "status": "acronym", "ipa": None, "syllables": [], "syllable_count": len(tok), "stressed": None,
                              "letters": " ".join(tok), "note": "Acronym: spoken letter by letter on purpose."})
            else:
                words.append({**lookup(tok, overrides), "lang": "en"})
    return {"words": words, "runs": segment(text)}


def technical_terms() -> list[str]:
    return sorted(pron_data.CURATED)
