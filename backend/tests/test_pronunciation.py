"""Pronunciation-layer quality tests. These verify the TEXT/PHONEME/SSML layer deterministically.
They deliberately do NOT claim audio quality: whether a voice sounds right needs the human listening pass
(tests/pron_cases.json -> human_listening_checklist, scripts/pron_listen.py)."""
import json
import os
import pathlib
import tempfile
import xml.etree.ElementTree as ET

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/p.db")
os.environ["LLM_PROVIDER"] = "offline"
import pytest  # noqa: E402

from app import pron, tts  # noqa: E402
from app.config import settings  # noqa: E402

CASES = json.loads((pathlib.Path(__file__).parent / "pron_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("word,expected", [(w, v) for w, v in CASES["words"].items() if not w.startswith("_")])
def test_syllables_and_stress(word, expected):
    r = pron.lookup(word)
    assert r["status"] in ("curated", "cmudict", "composed"), r
    assert r["syllable_count"] == expected[0], (word, r["ipa"])
    assert r["stressed"] == expected[1], (word, r["ipa"])


def test_unknown_word_is_not_invented():
    r = pron.lookup("zxqvlorb")
    assert r["status"] == "unknown" and r["ipa"] is None and r["syllables"] == []


def test_user_override_wins_and_is_reported():
    r = pron.lookup("algorithm", {"algorithm": "ˈæl.ɡə.ˌrɪ.ðm"})
    assert r["status"] == "override" and r["ipa"].startswith("ˈæl")


def test_ipa_shape_for_known_word():
    r = pron.lookup("artificial")
    assert r["ipa"] == "ˌɑːr.tə.ˈfɪ.ʃəl" or "ˈfɪ" in r["ipa"]
    assert r["spelling_syllables"] == "ar-ti-fi-cial"


def test_language_segmentation_keeps_english_phrases_together():
    runs = pron.segment("Okay, ab hum Machine Learning ka concept samajhte hain.")
    assert [r["lang"] for r in runs] == ["en", "hi", "en", "hi", "en", "hi"]
    assert runs[2]["text"].strip() == "Machine Learning"
    assert runs[1]["speech"].startswith("अब हम")                       # Hindi voice gets Devanagari
    assert "".join(r["text"] for r in runs) == "Okay, ab hum Machine Learning ka concept samajhte hain."   # nothing dropped or reordered


@pytest.mark.parametrize("s", CASES["mixed_sentences"])
def test_segmentation_never_loses_text(s):
    assert "".join(r["text"] for r in pron.segment(s)) == s


def test_devanagari_input_is_hindi():
    runs = pron.segment("चलो अब देखते हैं machine learning")
    assert runs[0]["lang"] == "hi" and runs[-1]["lang"] == "en"


def test_ssml_never_spells_normal_words_and_is_valid_xml():
    runs = pron.segment("Algorithm and Machine Learning with SQL and numpy")
    ssml = tts.azure_ssml(runs, "en-IN", True, 1.0, 1.0)
    ET.fromstring(ssml)                                                 # well-formed
    assert ssml.count("say-as") == 2                                    # open+close tag, for SQL only
    assert '>SQL</say-as>' in ssml and 'interpret-as="characters"' in ssml
    for normal in ("Algorithm", "Machine", "Learning", "numpy"):
        assert f'interpret-as="characters">{normal}' not in ssml
    assert 'alphabet="ipa"' in ssml and ">numpy</phoneme>" in ssml      # curated term gets a phoneme


def test_cmu_phonemes_are_not_forced_on_ordinary_words():
    ssml = tts.azure_ssml(pron.segment("Please understand this simple idea"), "en-IN", True, 1.0, 1.0)
    assert "<phoneme" not in ssml                                        # American reference IPA must not override an Indian voice


def test_mixed_language_uses_separate_voices_in_one_azure_request():
    ssml = tts.azure_ssml(pron.segment("Ab hum Machine Learning ka concept samajhte hain"), "en-IN", False, 1.0, 1.0)
    root = ET.fromstring(ssml)
    voices = [v.get("name") for v in root.iter("{http://www.w3.org/2001/10/synthesis}voice")]
    assert "hi-IN-MadhurNeural" in voices and "en-IN-PrabhatNeural" in voices
    assert "अब" in ssml and "समझते" in ssml


def test_google_is_segmented_per_language():
    reqs = tts.google_requests(pron.segment("Ab hum Machine Learning ka concept"), "en-IN", True, 1.0, 1.0)
    assert [r["voice"]["languageCode"] for r in reqs] == ["hi-IN", "en-IN", "hi-IN", "en-IN"]
    assert all("phoneme" not in r["input"]["ssml"] for r in reqs)        # google phonemes off by default


def test_user_override_is_sent_as_phoneme(monkeypatch):
    ssml = tts.azure_ssml(pron.segment("The widget works"), "en-IN", True, 1.0, 1.0, {"widget": "ˈwɪ.dʒɪt"})
    assert 'ph="ˈwɪdʒɪt"' in ssml and ">widget</phoneme>" in ssml


def test_elevenlabs_text_spells_only_acronyms():
    t = tts.eleven_text("ab SQL algorithm")
    assert t == "अब S Q L algorithm"


def test_provider_requests_and_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_provider", "azure"); monkeypatch.setattr(settings, "azure_speech_key", "k")
    monkeypatch.setattr(settings, "tts_cache_dir", str(tmp_path))
    sent = []

    class R:
        status_code = 200; content = b"MP3DATA"; text = ""
    monkeypatch.setattr(tts.httpx, "post", lambda url, **kw: sent.append((url, kw)) or R())
    a = tts.synthesize("Ab Machine Learning", female=True)
    b = tts.synthesize("Ab Machine Learning", female=True)          # served from cache
    assert a == b == b"MP3DATA" and len(sent) == 1
    url, kw = sent[0]
    assert "centralindia.tts.speech.microsoft.com" in url and kw["headers"]["Content-Type"] == "application/ssml+xml"
    assert b"hi-IN-SwaraNeural" in kw["content"]


def test_phoneme_probe_detects_ignored_tags(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "tts_provider", "azure"); monkeypatch.setattr(settings, "azure_speech_key", "k")
    monkeypatch.setattr(settings, "tts_cache_dir", str(tmp_path))

    class R:
        status_code = 200; text = ""
        def __init__(self, c): self.content = c
    monkeypatch.setattr(tts.httpx, "post", lambda url, **kw: R(b"same"))           # provider ignores phonemes
    assert tts.probe_phonemes()["phoneme_honoured"] is False
    monkeypatch.setattr(tts.httpx, "post", lambda url, **kw: R(b"X" + kw["content"]))  # audio depends on the SSML
    monkeypatch.setattr(settings, "tts_cache_dir", str(tmp_path / "2"))
    assert tts.probe_phonemes()["phoneme_honoured"] is True


def test_browser_provider_reports_no_phoneme_control():
    from app.tts import CAPS
    assert CAPS["browser"]["phoneme"] == "none"
