"""Configurable text-to-speech providers with language-aware segmentation, SSML and phoneme control.

CAPABILITIES (from provider documentation, checked when this module was written - re-verify for your account/voices):
  azure       SSML yes. Several <voice> elements (e.g. en-IN + hi-IN) in ONE request: yes -> no gap between languages.
              <phoneme alphabet="ipa">: documented feature, but NOT confirmed for the Indian voices -> use /api/pron/probe.
  google      SSML yes. One voice per request -> segmented requests. <phoneme>: reported to be silently ignored for en-IN
              (2021 developer report) and unconfirmed for hi-IN -> off by default.
  elevenlabs  No SSML phoneme for multilingual models; <phoneme> English-only on a few models (docs disagree). Handles
              mixed Hindi/English text in ONE request, so no segmentation. Custom pronunciations need its dictionary (alias).
  browser     Web Speech API: no SSML, no phonemes. Per-language utterances are done in the frontend instead.
Unsupported tags are silently ignored by providers, so phoneme support is TESTED (probe_phonemes), never assumed."""
import base64
import hashlib
import json
import os
from xml.sax.saxutils import escape

import httpx

from . import pron, pron_data
from .config import settings
from .hinglish import speechify

CAPS = {
    "azure": {"ssml": True, "phoneme": "unverified-for-indian-voices", "inline_language_switch": True, "segmented": False},
    "google": {"ssml": True, "phoneme": "reported-ignored-for-en-IN", "inline_language_switch": False, "segmented": True},
    "elevenlabs": {"ssml": False, "phoneme": "english-only-some-models", "inline_language_switch": True, "segmented": False},
    "browser": {"ssml": False, "phoneme": "none", "inline_language_switch": False, "segmented": True},
}
# Default voices per provider/accent/gender. Names follow each provider's published voice lists; confirm them in YOUR account
# and override with TTS_VOICES_JSON if needed.
VOICES = {
    "azure": {"en-IN": {"f": "en-IN-NeerjaNeural", "m": "en-IN-PrabhatNeural"}, "en-GB": {"f": "en-GB-SoniaNeural", "m": "en-GB-RyanNeural"},
              "en-US": {"f": "en-US-JennyNeural", "m": "en-US-GuyNeural"}, "hi-IN": {"f": "hi-IN-SwaraNeural", "m": "hi-IN-MadhurNeural"},
              "gu-IN": {"f": "gu-IN-DhwaniNeural", "m": "gu-IN-NiranjanNeural"}},
    "google": {"en-IN": {"f": "en-IN-Neural2-A", "m": "en-IN-Neural2-B"}, "en-GB": {"f": "en-GB-Neural2-A", "m": "en-GB-Neural2-B"},
               "en-US": {"f": "en-US-Neural2-F", "m": "en-US-Neural2-D"}, "hi-IN": {"f": "hi-IN-Neural2-A", "m": "hi-IN-Neural2-B"},
               "gu-IN": {"f": "gu-IN-Wavenet-A", "m": "gu-IN-Wavenet-B"}},
}


class TTSError(Exception):
    pass


def provider() -> str:
    return settings.tts_provider if configured(settings.tts_provider) else "browser"


def configured(p: str) -> bool:
    return {"azure": bool(settings.azure_speech_key), "google": bool(settings.google_tts_api_key),
            "elevenlabs": bool(settings.elevenlabs_api_key and (settings.elevenlabs_voice_female or settings.elevenlabs_voice_male)), "browser": True}.get(p, False)


def phonemes_enabled(p: str) -> bool:
    return settings.tts_phonemes == "on" or (settings.tts_phonemes == "auto" and p == "azure")


def _voice(p: str, lang: str, female: bool) -> str:
    table = {**VOICES.get(p, {})}
    if settings.tts_voices_json:
        table = {**table, **json.loads(settings.tts_voices_json).get(p, {})}
    return table[lang]["f" if female else "m"]


# ---------- SSML / text markup ----------
def mark_english(text: str, p: str, overrides: dict[str, str] | None) -> str:
    """Escapes text and adds <say-as> ONLY for real acronyms, and <phoneme> ONLY for words with a known (override/curated/brand)
    pronunciation. Ordinary words are left as plain text so the voice's own Indian English lexicon is used - American CMU phonemes
    are never forced onto an Indian voice, and no word is ever spelled out letter by letter."""
    out = []
    for tok in pron._TOKEN.findall(text):
        if not tok[:1].isalpha():
            out.append(escape(tok)); continue
        if pron.is_acronym(tok):
            out.append(f'<say-as interpret-as="characters">{escape(tok)}</say-as>' if p in ("azure", "google") else escape(" ".join(tok)))
            continue
        w = tok.lower()
        ipa = (overrides or {}).get(w) or pron_data.CURATED.get(w)
        if ipa and phonemes_enabled(p):
            out.append(f'<phoneme alphabet="ipa" ph="{escape(ipa.replace(".", ""), {chr(34): "&quot;"})}">{escape(tok)}</phoneme>')
        else:
            out.append(escape(tok))
    return "".join(out)


def _prosody(rate: float, pitch: float) -> tuple[str, str]:
    return f"{rate:.2f}", f"{(pitch - 1) * 100:+.0f}%"


def azure_ssml(runs: list[dict], accent: str, female: bool, rate: float, pitch: float, overrides=None) -> str:
    r, pt = _prosody(rate, pitch)
    parts = []
    for run in runs:
        lang = "hi-IN" if run["lang"] == "hi" else accent
        body = escape(run["speech"]) if run["lang"] == "hi" else mark_english(run["speech"], "azure", overrides)
        parts.append(f'<voice name="{_voice("azure", lang, female)}"><prosody rate="{r}" pitch="{pt}">{body}</prosody></voice>')
    return f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{accent}">{"".join(parts)}</speak>'


def google_requests(runs: list[dict], accent: str, female: bool, rate: float, pitch: float, overrides=None) -> list[dict]:
    reqs = []
    for run in runs:
        lang = "hi-IN" if run["lang"] == "hi" else accent
        body = escape(run["speech"]) if run["lang"] == "hi" else mark_english(run["speech"], "google", overrides)
        reqs.append({"input": {"ssml": f"<speak>{body}</speak>"}, "voice": {"languageCode": lang, "name": _voice("google", lang, female)},
                     "audioConfig": {"audioEncoding": "MP3", "speakingRate": round(rate, 2), "pitch": round((pitch - 1) * 10, 1)}})
    return reqs


def eleven_text(text: str) -> str:
    """ElevenLabs reads mixed text natively: Hindi words go in Devanagari, acronyms are spaced letters."""
    toks = []
    for tok in pron._TOKEN.findall(speechify(text)):
        toks.append(" ".join(tok) if pron.is_acronym(tok) else tok)
    return "".join(toks)


# ---------- synthesis ----------
def _post(url: str, **kw) -> httpx.Response:
    try:
        r = httpx.post(url, timeout=40, **kw)
    except httpx.HTTPError as e:
        raise TTSError(f"The speech service could not be reached ({e.__class__.__name__}).")
    if r.status_code in (401, 403):
        raise TTSError("The speech provider rejected the API key/region. Check your TTS settings.")
    if r.status_code >= 400:
        raise TTSError(f"The speech provider returned an error ({r.status_code}): {r.text[:160]}")
    return r


def synthesize(text: str, *, female: bool, accent: str = "en-IN", rate: float = 1.0, pitch: float = 1.0, slow: bool = False,
               overrides: dict[str, str] | None = None, p: str | None = None) -> bytes:
    p = p or provider()
    if p == "browser":
        raise TTSError("No cloud speech provider is configured; the browser voice is used.")
    rate = max(0.5, min(1.5, rate * (0.7 if slow else 1.0)))
    runs = pron.segment(text)
    key = hashlib.sha256(json.dumps([p, text, female, accent, rate, pitch, overrides, phonemes_enabled(p)], sort_keys=True).encode()).hexdigest()
    path = os.path.join(settings.tts_cache_dir, key + ".mp3")
    if os.path.exists(path):
        return open(path, "rb").read()
    if p == "azure":
        ssml = azure_ssml(runs, accent, female, rate, pitch, overrides)
        r = _post(f"https://{settings.azure_speech_region}.tts.speech.microsoft.com/cognitiveservices/v1",
                  headers={"Ocp-Apim-Subscription-Key": settings.azure_speech_key, "Content-Type": "application/ssml+xml",
                           "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "lumetra-classora"}, content=ssml.encode())
        audio = r.content
    elif p == "google":
        audio = b"".join(base64.b64decode(_post(f"https://texttospeech.googleapis.com/v1/text:synthesize?key={settings.google_tts_api_key}", json=q).json()["audioContent"])
                         for q in google_requests(runs, accent, female, rate, pitch, overrides))
    elif p == "elevenlabs":
        vid = settings.elevenlabs_voice_female if female else settings.elevenlabs_voice_male
        vid = vid or settings.elevenlabs_voice_female or settings.elevenlabs_voice_male
        r = _post(f"https://api.elevenlabs.io/v1/text-to-speech/{vid}", headers={"xi-api-key": settings.elevenlabs_api_key},
                  json={"text": eleven_text(text), "model_id": settings.elevenlabs_model, "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": max(0.7, min(1.2, rate))}})
        audio = r.content
    else:
        raise TTSError(f"Unknown TTS provider '{p}'.")
    os.makedirs(settings.tts_cache_dir, exist_ok=True)
    open(path, "wb").write(audio)
    return audio


def probe_phonemes(word: str = "tomato", female: bool = True, accent: str = "en-IN") -> dict:
    """Does this provider+voice actually HONOUR <phoneme>? Synthesises the same word with a deliberately WRONG IPA and with none;
    identical audio means the tag was silently ignored. Costs 2 short requests."""
    p = provider()
    if p == "browser":
        return {"provider": p, "phoneme_honoured": False, "detail": "Browser voices have no phoneme control."}
    if p == "elevenlabs" or not phonemes_enabled(p):
        return {"provider": p, "phoneme_honoured": None, "detail": "Phoneme tags are disabled for this provider (see TTS_PHONEMES)."}
    plain = synthesize(word, female=female, accent=accent, p=p)
    wrong = synthesize(word, female=female, accent=accent, p=p, overrides={word: "ˈzuː.zuː"})
    honoured = plain != wrong
    return {"provider": p, "voice": _voice(p, accent, female), "phoneme_honoured": honoured,
            "detail": "Phoneme tags change the audio: supported." if honoured else "Audio was identical with a wrong phoneme: this voice IGNORES phoneme tags. Set TTS_PHONEMES=off and use user corrections/respelling instead."}
