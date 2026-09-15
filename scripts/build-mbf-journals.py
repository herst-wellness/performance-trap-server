#!/usr/bin/env python3
"""Generate mbf-journal-content.js from the curriculum.

The journals on the site had drifted a long way from the curriculum. Two Module
3 journals were live that exist nowhere in the source files, the Module 2 set
was mostly from an earlier version of the programme, and not one of the seven
Follow-Up journals had ever been built, even though Chad uses one after every
session. The numbering gave it away: the live Module 3 ran to 03.08 and the
current one stops at 03.04A.

So the journals are generated from the markdown rather than kept in step by
hand. Modules 1 to 3 take the rewritten versions from the voice pass; the rest
take the current source files.

    python3 scripts/build-mbf-journals.py

A test re-runs this and fails if the checked-in file differs, so the two cannot
drift apart again.
"""
import json, os, re, sys

SRC = "/Users/chadherst/Library/CloudStorage/Dropbox/ML/Mind:Body Foundations/Module Source Files"
VOICE = "/Users/chadherst/Library/CloudStorage/Dropbox/ML/Mind:Body Foundations/Voice Pass 2026-09-13"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mbf-journal-content.js")

# A journal is a file the client writes in. Rather than guess from the title,
# which puts Reaching Out (instructions) and A New Invitation (a chapter) on the
# wrong side, this is defined against the readings: anything already built as a
# reading page is not a journal. What is left is the numbered extras plus the
# session preps.
READINGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mbf-readings")

def reading_titles():
    out = set()
    for f in os.listdir(READINGS_DIR):
        m = re.match(r"^(\d\d)-(\d\d[a-z]?)-", f)
        if m:
            out.add(m.group(1) + "." + m.group(2).upper())
    return out

READINGS = reading_titles()

def is_journal(code, title):
    if re.search(r"Roadmap|What You See In Me", title, re.I):
        return False
    # The container document is Chad explaining how sessions run, not a journal.
    if code == "01.02":
        return False
    if code in READINGS:
        return False
    return bool(re.match(r"^\d\d\.\d\d[A-Z]$", code)) or re.search(r"Session Prep", title, re.I)

# \fieldagree is a yes-or-no, not a box. Chad's eleven working agreements are
# the only place it is used, and they were live on the site while existing only
# there: the curriculum had no record of them at all. They are in the curriculum
# now, so the generator carries them rather than someone remembering to.
FIELD = {"fieldsmall": "short", "fieldmedium": "long", "fieldlarge": "long", "fieldagree": "agree"}

def slugify(s):
    s = s.lower().replace("'", "").replace("\u2019", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    # The file is called "Turning Point Journal"; the page is just the turning
    # point. The same for "Journaling", and for a leading "the".
    s = re.sub(r"-(journal|journaling)$", "", s)
    s = re.sub(r"^the-", "", s)
    return s

def paragraphs(block):
    out = []
    for p in block.split("\n\n"):
        p = " ".join(p.split())
        if p:
            out.append(p)
    return out

def blurb_from(sections):
    """The first real question, short enough for the index card."""
    for section in sections:
        for prompt in section["prompts"]:
            return prompt["text"][:110].rsplit(" ", 1)[0] + "\u2026"
    return ""

def parse(path, module, code, title):
    slug = slugify(title)
    raw = open(path, encoding="utf-8").read()
    raw = re.split(r"^##\s+Figure source", raw, flags=re.M)[0]
    raw = re.sub(r"\\begin\{center\}.*?\\end\{center\}", "", raw, flags=re.S)
    raw = re.sub(r"^#\s+.*$", "", raw, count=1, flags=re.M)

    parts = re.split(r"^##\s+(.+)$", raw, flags=re.M)
    head, rest = parts[0], parts[1:]

    intro = " ".join(paragraphs(re.sub(r"^\s*\\\w+\s*$", "", head, flags=re.M)))
    intro = re.sub(r"\*+", "", intro).strip()

    sections = []
    n_prompt = 0
    for i in range(0, len(rest), 2):
        heading = rest[i].strip()
        body = rest[i + 1]
        kinds = re.findall(r"\\(field\w+)", body)
        body = re.sub(r"^\s*\\\w+\s*$", "", body, flags=re.M)
        paras = paragraphs(body)
        if not paras:
            continue
        # A section with no field marker is an instruction, not a question. The
        # "Before you begin" settle-in is the commonest: it tells the client to
        # breathe first, and giving it a box would ask them to write about it.
        if not kinds:
            sections.append({"heading": heading, "note": " ".join(paras), "prompts": []})
            continue
        kind = FIELD.get(kinds[0], "long")
        # A section with several field markers is a multi-part prompt; each
        # paragraph that precedes one is its own box.
        if len(kinds) > 1:
            prompts = []
            usable = [p for p in paras if len(p) > 20][: len(kinds)]
            for n, para in enumerate(usable, 1):
                n_prompt += 1
                prompts.append({"id": "%s-%d" % (slug, n_prompt),
                                "kind": FIELD.get(kinds[n - 1] if n - 1 < len(kinds) else "", "long"),
                                "label": re.sub(r"\*+", "", para.split(".")[0])[:60],
                                "text": para})
            sections.append({"heading": heading, "prompts": prompts})
        else:
            n_prompt += 1
            sections.append({"heading": heading,
                             "prompts": [{"id": "%s-%d" % (slug, n_prompt),
                                          "kind": kind, "label": heading, "text": " ".join(paras)}]})
    return {"module": module, "slug": slug, "code": code,
            "kind": "Session prep" if "session prep" in title.lower() else "Journal",
            "title": title,
            "blurb": blurb_from(sections),
            "intro": intro, "sections": sections}

def main():
    journals = []
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".md") or "retired" in name:
            continue
        base = name[:-3]
        m = re.match(r"^(\d\d)\.(\d\d[A-Z]?) (.+)$", base)
        if not m:
            continue
        module, code, title = int(m.group(1)), m.group(1) + "." + m.group(2), m.group(3)
        if not is_journal(code, title):
            continue
        # The file is "Beginner's Mind Journal"; the page, and the filename the
        # client's answers land under in Chad's Dropbox, is "Beginner's Mind".
        # Those delivered filenames already exist, so the title has to keep its
        # current shape or a client's file would be orphaned mid-programme.
        title = re.sub(r"\s+(Journal|Journaling)$", "", title)
        # A typographic apostrophe, because the title is read by a client and
        # also becomes the filename their answers land under.
        title = title.replace("'", "\u2019")
        vp = os.path.join(VOICE, name)
        journals.append(parse(vp if os.path.exists(vp) else os.path.join(SRC, name), module, code, title))

    # A slug is the whole address, so it has to be unique across the programme,
    # not just inside a module. Six modules have a Session Prep and seven have a
    # Follow-Up, so those carry their module number.
    counts = {}
    for j in journals:
        counts[j["slug"]] = counts.get(j["slug"], 0) + 1
    for j in journals:
        if counts[j["slug"]] > 1:
            j["slug"] = re.sub(r"-journaling$", "", j["slug"]) + "-%d" % j["module"]
    seen = set()
    for j in journals:
        assert j["slug"] not in seen, "two journals answer to " + j["slug"]
        seen.add(j["slug"])

    # Prompt ids are built from the slug, and the slug is only final now, so the
    # ids are stamped here. They have to be unique across the whole programme:
    # a client's answers are stored by id, so two prompts sharing one would have
    # each overwrite the other.
    ids = set()
    for j in journals:
        n = 0
        for section in j["sections"]:
            for prompt in section["prompts"]:
                n += 1
                prompt["id"] = "%s-%d" % (j["slug"], n)
                assert prompt["id"] not in ids, "two prompts share " + prompt["id"]
                ids.add(prompt["id"])

    body = ",\n".join("  " + json.dumps(j, ensure_ascii=False) for j in journals)
    js = '''// The Mind/Body Foundations journals.
//
// GENERATED. Do not edit by hand: run scripts/build-mbf-journals.py, which
// reads the curriculum in Dropbox. Modules 1 to 3 take the rewritten journals
// from the voice pass; the rest take the current source files. A test re-runs
// the generator and fails if this file has drifted from it.
//
// It is generated because the hand-kept version drifted badly. Two Module 3
// journals were live that exist nowhere in the curriculum, most of Module 2 was
// from an earlier version of the programme, and not one of the seven Follow-Up
// journals had ever been built, though Chad uses one after every session.
const JOURNALS = [
%s
];

const BY_SLUG = new Map(JOURNALS.map((j) => [j.slug, j]));

function findJournal(moduleNumber, slug) {
  const journal = BY_SLUG.get(slug);
  if (!journal || journal.module !== Number(moduleNumber)) return null;
  return journal;
}

function allPrompts(journal) {
  const out = [];
  for (const section of journal.sections) {
    for (const prompt of section.prompts) out.push(prompt);
  }
  return out;
}

function journalsForModule(moduleNumber) {
  return JOURNALS.filter((j) => j.module === Number(moduleNumber));
}

module.exports = { JOURNALS, findJournal, allPrompts, journalsForModule };
''' % body
    if "--check" in sys.argv:
        current = open(OUT, encoding="utf-8").read()
        sys.exit(0 if current == js else 1)
    open(OUT, "w", encoding="utf-8").write(js)
    print("%d journals" % len(journals))
    for j in journals:
        print("  M%d  %-9s %-34s %2d sections" % (j["module"], j["code"], j["title"], len(j["sections"])))

main()
