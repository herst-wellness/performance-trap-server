"""Recover the blank prompts of a Mind/Body Foundations journal.

Two people answering the same journal share only the printed questions. So
the prompts are the lines that appear in every copy, and the answers are
everything else. This keeps the shared lines and discards the rest, which
means nobody's written answers are ever read or carried forward.
"""
import subprocess, sys, re, os, json
from pathlib import Path

def text(path):
    out = subprocess.run(["pdftotext", "-layout", str(path), "-"],
                         capture_output=True, text=True).stdout
    lines = []
    for raw in out.splitlines():
        line = raw.strip()
        if not line:
            continue
        if "ALL RIGHTS RESERVED" in line:
            continue
        if re.match(r"^(JOURNAL|WELCOME|SESSION PREP)\s+\d", line):
            continue
        if re.match(r"^\d+ of \d+$", line):
            continue
        lines.append(line)
    return lines

def common(copies):
    """Lines present in every copy, in the order of the first copy."""
    if not copies:
        return []
    others = [set(c) for c in copies[1:]]
    kept, seen = [], set()
    for line in copies[0]:
        if line in seen:
            continue
        if all(line in o for o in others):
            kept.append(line)
            seen.add(line)
    return kept

if __name__ == "__main__":
    paths = [Path(p) for p in sys.argv[1:]]
    copies = [text(p) for p in paths]
    for line in common(copies):
        print(line)
