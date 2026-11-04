# Pronunciation engine

## How it works
```
text ──► pron.segment ──► language runs (Hindi / English)           Roman-Hindi words -> Devanagari for the Hindi voice
          │                 "Okay," en │ "ab hum" hi │ "Machine Learning" en │ "ka" hi │ "concept" en │ "samajhte hain." hi
          ├─► Azure   : ONE SSML request, a <voice> element per run (en-IN voice <-> hi-IN voice, no gap)
          ├─► Google  : one request per run (one voice per request), MP3 parts joined
          ├─► ElevenLabs: whole mixed text in one request (multilingual model); acronyms spaced
          └─► Browser : one utterance per run, each with a voice FOR THAT LANGUAGE (en-IN voice for English, hi-IN for Hindi)
```
Rules enforced in code and tested (`tests/test_pronunciation.py`):
* ordinary words are never spelled out; `say-as characters` is used only for real acronyms (SQL, CPU, API …);
* **American CMU phonemes are never forced onto an Indian-English voice.** `<phoneme>` is sent only for words with a known
  pronunciation (your own corrections, the curated technical list, product names). CMUdict is used for *display* (IPA, syllables, stress);
* nothing is invented: unknown words get status `unknown` and no phonetics; composed words are labelled "unverified";
* nothing is silently replaced or dropped (segmentation is lossless - tested).

## Lookup order
user correction → curated technical list (`pron_data.py`, **not lexicographer-reviewed**) → CMU Pronouncing Dictionary (open, US reference)
→ composed from two dictionary words (unverified) → unknown. Hindi: no IPA is guessed; spoken from Devanagari by a Hindi voice.

## Provider comparison (checked against documentation; re-verify for your account)
| | Azure AI Speech | Google Cloud TTS | ElevenLabs | Browser |
|---|---|---|---|---|
| Indian English voices | en-IN Neerja, Prabhat (+ bilingual en-IN/hi-IN voices) | en-IN Neural2/Wavenet | via voice library | OS voices (en-IN if installed) |
| Hindi | hi-IN Swara, Madhur | hi-IN Neural2 | multilingual v2 | OS hi-IN voice |
| English+Hindi in one sentence | **yes**, several `<voice>` in one SSML | no - separate requests | yes (multilingual model) | separate utterances |
| IPA `<phoneme>` | documented; **not confirmed for Indian voices → probe** | reported **ignored for en-IN** (2021), unconfirmed hi-IN | English only, some models; Hindi needs dictionary aliases | none |
| Cost | paid (free tier) | paid (free tier) | paid (free tier) | free |

Recommended: **Azure** (best fit for Indian English + Hindi code-switching and SSML control). This is a recommendation from
documentation, not from listening tests - run the listening pass below before relying on it.

## Setup (backend/.env)
```
TTS_PROVIDER=azure          # azure | google | elevenlabs | browser
AZURE_SPEECH_KEY=...        AZURE_SPEECH_REGION=centralindia
GOOGLE_TTS_API_KEY=...      # google
ELEVENLABS_API_KEY=...  ELEVENLABS_VOICE_FEMALE=<voice id>  ELEVENLABS_VOICE_MALE=<voice id>
TTS_PHONEMES=auto           # auto (azure only) | on | off
TTS_VOICES_JSON={"azure":{"en-IN":{"f":"en-IN-NeerjaNeural","m":"en-IN-PrabhatNeural"}}}   # optional voice overrides
```
Audio is cached on disk (`tts_cache/`) so repeated sentences cost nothing. Providers can be switched by changing `TTS_PROVIDER` only.
Not implemented: Amazon Polly (needs AWS request signing), Gujarati cloud synthesis (falls back to the browser voice).

## Quality testing - what is and is not proven
1. **Automated (run on every change):** `pytest tests/test_pronunciation.py` - word identity, syllable counts and stress for ~24 CS/English words,
   language segmentation (lossless), SSML well-formed, no spelling-out, correct voices per language, provider request shape, caching.
   These prove the *text/phoneme/SSML layer*, **not** that a voice sounds right.
2. **Phoneme probe (needs a provider):** Pronunciation page → "Test phoneme support". Synthesises one word with a deliberately wrong IPA
   and with none; identical audio = the voice ignores phoneme tags (then set `TTS_PHONEMES=off`).
3. **Human listening (required before declaring a voice accurate):** `python scripts/pron_listen.py en-IN` writes mp3s + `listening_sheet.md`.
   A listener ticks each item against the checklist in `tests/pron_cases.json`. Repeat for each voice/accent you ship.
4. **Student practice** compares what the browser's recogniser heard with the target text. That measures recognition, not pronunciation.
   True scoring needs Azure Pronunciation Assessment (not connected yet).
