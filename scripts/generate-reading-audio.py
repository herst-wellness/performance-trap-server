#!/usr/bin/env python3
"""Read Chad's written material aloud in a computer voice.

Chad reads screen text with the Kokoro voice am_michael and likes it, so the
readings get the same voice rather than whatever a client's browser happens to
have. These files are a stand-in. When Chad records a chapter himself the
recording replaces the file of the same name and nothing else changes.

Run it with the Speak11 virtual environment, which already has mlx-audio and
the Kokoro weights. With no arguments it reads the Mind/Body Foundations
chapters:

    ~/.local/share/speak11/venv/bin/python3 scripts/generate-reading-audio.py

The Performance Trap Practice pieces live inside the week pages rather than in
files, so `node scripts/extract-onramp-readings.js` writes them out first and
this then reads that folder:

    node scripts/extract-onramp-readings.js
    ~/.local/share/speak11/venv/bin/python3 scripts/generate-reading-audio.py \
        --source build/onramp-readings --out build/onramp-audio \
        --manifest onramp-reading-audio.json

It writes one MP3 per chapter into build/reading-audio/, then rewrites
mbf-reading-audio.json, which is what the module pages read to know how long
each chapter runs before anyone presses play. Pass slugs to redo only some of
them, e.g. `01-01-welcome`; the list is rebuilt from every file present, so a
partial run still leaves a complete list.

Roughly fourteen minutes of speech a minute on an Apple Silicon Mac.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
READINGS = ROOT / "mbf-readings"
OUT = ROOT / "build" / "reading-audio"
MANIFEST = ROOT / "mbf-reading-audio.json"
SUFFIXES = (".md", ".txt")

MODEL = "mlx-community/Kokoro-82M-bf16"

# Chad reads his own screen with am_michael and named af_heart as the other one
# he likes, so those are the two a listener chooses between. The key is what the
# pages and the bucket call the voice; the Kokoro name is an implementation
# detail that never reaches a page.
VOICES = {
    "michael": "am_michael",
    "heart": "af_heart",
}
VOICE_KEY = "michael"
VOICE = VOICES[VOICE_KEY]

# Kokoro drops words when it is asked to read much faster than it wants to, so
# the file is made at a natural pace and the page does the speeding up. A
# listener who wants it at twice the speed gets that without losing syllables.
SPEED = 1.0

# Said aloud, a slash is a slash. These are the ones that appear in the
# chapters; anything else goes through untouched.
SPOKEN = [
    (r"Mind/Body", "Mind Body"),
    (r"\bw/\b", "with"),
    (r"\be\.g\.\s*", "for example, "),
    (r"\bi\.e\.\s*", "that is, "),
    (r"\betc\.", "and so on."),
]


def to_speech(src):
    """Markdown into something a voice can read without saying the punctuation."""
    out = []
    for raw in src.split("\n"):
        line = raw.strip()
        if not line or re.match(r"^-{3,}$", line):
            out.append("")
            continue
        heading = re.match(r"^(#{1,4})\s+(.*)$", line)
        if heading:
            # A heading is a spoken sentence, and the blank lines around it
            # become the pause that tells a listener a new part has started.
            out += ["", heading[2].strip().rstrip(".") + ".", ""]
            continue
        line = re.sub(r"^>\s?", "", line)
        item = re.match(r"^[-*]\s+(.*)$", line)
        if item:
            line = item[1].strip()
            if line and line[-1] not in ".!?:;,":
                line += "."
        line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)
        line = line.replace("**", "").replace("__", "")
        line = re.sub(r"(?<!\w)\*([^*]+)\*(?!\w)", r"\1", line).replace("*", "")
        line = line.replace("`", "")
        for pattern, spoken in SPOKEN:
            line = re.sub(pattern, spoken, line)
        out.append(line)
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def master(wav, mp3):
    """Level every chapter the same so nobody reaches for the volume."""
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(wav),
         "-af", "aformat=channel_layouts=mono,loudnorm=I=-19:TP=-3:LRA=11",
         "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", "-ac", "1", str(mp3)],
        check=True,
    )


def seconds(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def parse_args(argv):
    """--source, --out, --manifest and --voice, then any stems to redo."""
    global READINGS, OUT, MANIFEST, VOICE, VOICE_KEY
    stems = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--source" and i + 1 < len(argv):
            READINGS = (ROOT / argv[i + 1]).resolve()
            i += 2
        elif arg == "--out" and i + 1 < len(argv):
            OUT = (ROOT / argv[i + 1]).resolve()
            i += 2
        elif arg == "--manifest" and i + 1 < len(argv):
            MANIFEST = (ROOT / argv[i + 1]).resolve()
            i += 2
        elif arg == "--voice" and i + 1 < len(argv):
            VOICE_KEY = argv[i + 1]
            if VOICE_KEY not in VOICES:
                print("Unknown voice " + VOICE_KEY + ". Try: " + ", ".join(VOICES),
                      file=sys.stderr)
                return None
            VOICE = VOICES[VOICE_KEY]
            i += 2
        elif arg.startswith("--"):
            print("Unknown option " + arg, file=sys.stderr)
            return None
        else:
            stems.append(arg)
            i += 1
    return set(stems)


def main():
    from mlx_audio.tts.generate import generate_audio
    from mlx_audio.tts.utils import load_model

    wanted = parse_args(sys.argv[1:])
    if wanted is None:
        return 1
    files = sorted(p for p in READINGS.iterdir()
                   if p.suffix in SUFFIXES and (not wanted or p.stem in wanted))
    if not files:
        print("No chapters matched.", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Loading {VOICE} as \"{VOICE_KEY}\". {len(files)} chapters to read.", flush=True)
    model = load_model(MODEL)

    for index, path in enumerate(files, 1):
        mp3 = OUT / (path.stem + ".mp3")
        text = to_speech(path.read_text(encoding="utf8"))
        started = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            here = os.getcwd()
            os.chdir(tmp)
            try:
                generate_audio(
                    text=text, model=model, voice=VOICE, speed=SPEED,
                    lang_code=VOICE[0], file_prefix="chapter",
                    audio_format="wav", join_audio=True, verbose=False,
                )
            finally:
                os.chdir(here)
            wav = Path(tmp) / "chapter.wav"
            if not wav.exists() or wav.stat().st_size == 0:
                print(f"  FAILED {path.stem}", file=sys.stderr, flush=True)
                continue
            master(wav, mp3)
        length = seconds(mp3)
        print(f"[{index}/{len(files)}] {path.stem}  "
              f"{int(length // 60)}m{int(length % 60):02d}s  "
              f"{mp3.stat().st_size // 1024} KB  "
              f"made in {int(time.time() - started)}s", flush=True)

    write_manifest()
    return 0


def write_manifest():
    """What the pages need: which chapters have audio, in which voice, and how
    long each one runs in that voice. A voice is added to what is already
    listed rather than replacing it, so making Heart does not lose Michael."""
    existing = {}
    if MANIFEST.exists():
        try:
            existing = json.loads(MANIFEST.read_text(encoding="utf8"))
        except ValueError:
            existing = {}
    chapters = existing.get("chapters") or {}

    for mp3 in sorted(OUT.glob("*.mp3")):
        per_voice = chapters.setdefault(mp3.stem, {})
        per_voice[VOICE_KEY] = {
            "seconds": round(seconds(mp3), 1),
            "bytes": mp3.stat().st_size,
        }

    MANIFEST.write_text(json.dumps({
        "spoken_by": existing.get("spoken_by", "computer"),
        "chapters": chapters,
    }, indent=2) + "\n", encoding="utf8")
    made = sum(1 for c in chapters.values() if VOICE_KEY in c)
    total = sum(c[VOICE_KEY]["seconds"] for c in chapters.values() if VOICE_KEY in c)
    print(f"{made} chapters in {VOICE_KEY}, {total / 3600:.1f} hours, "
          f"listed in {MANIFEST.name}.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
