"""Generates audio for the pronunciation test set so a HUMAN can listen and sign off.
Usage (from backend/, with TTS_PROVIDER + keys set in .env):   python scripts/pron_listen.py [accent] [out_dir]
Output: one mp3 per word / sentence (normal and slow) plus listening_sheet.md with the checklist.
Passing this script only proves audio was generated - it does NOT prove the pronunciation is right."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app import pron, tts  # noqa: E402

accent = sys.argv[1] if len(sys.argv) > 1 else "en-IN"
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "pron_listening"); out.mkdir(exist_ok=True)
cases = json.loads((pathlib.Path(__file__).resolve().parents[1] / "tests" / "pron_cases.json").read_text(encoding="utf-8"))
if tts.provider() == "browser":
    sys.exit("No cloud provider configured (TTS_PROVIDER). Set one in backend/.env first.")

rows = []
items = [(w, w) for w in cases["words"] if not w.startswith("_")] + [(f"sentence_{i}", s) for i, s in enumerate(cases["mixed_sentences"])]
for name, text in items:
    info = pron.analyze(text)["words"]
    for slow in (False, True):
        fn = out / f"{name}{'_slow' if slow else ''}.mp3"
        fn.write_bytes(tts.synthesize(text, female=True, accent=accent, slow=slow))
    rows.append(f"| {name} | {text} | " + ", ".join(f"{w['word']} /{w['ipa']}/" for w in info if w.get("ipa")) + " | [ ] |")

sheet = ["# Pronunciation listening sheet", f"Provider: {tts.provider()}  Accent: {accent}", "", "Tick the last column only after listening.", "",
         "| file | text | expected phonetics | OK |", "|---|---|---|---|", *rows, "", "## Checklist", *[f"- [ ] {c}" for c in cases["human_listening_checklist"]]]
(out / "listening_sheet.md").write_text("\n".join(sheet), encoding="utf-8")
print(f"Wrote {len(items) * 2} audio files and {out / 'listening_sheet.md'}")
