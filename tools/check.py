#!/usr/bin/env python3
"""Offline content check for the app (DESIGN §21.2). No dependencies. Exit 0 = pass.

    python3 tools/check.py          # check
    python3 tools/check.py --fix    # also rewrite sw.js SHELL to the current content hash

Checks: index.json <-> lesson files, exercise schema, theory cross-check (degree_to_chord,
chord_to_degree, relative_minor, progression_build, family_sort, fretboard_find, every clip's
pitches vs its label, ear_degree cadence + target, interval_inversion pairs), privacy (generic
patterns over every shipped text file, the private terms file when present, no audio files),
and the offline shell (sw.js lists every module/style/icon, SHELL is the content hash of the
shell files, index.html modulepreloads every module).
"""
import hashlib
import json
import os
import re
import sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LESSONS = os.path.join(APP, "data", "lessons")
TERMS = os.path.join(os.path.dirname(APP), "private", "terms.txt")

KNOWN = {"mcq", "degree_to_chord", "chord_to_degree", "relative_minor", "interval_inversion", "fill_blank",
         "ear_degree", "ear_quality", "progression_build", "family_sort", "fretboard_find"}
CHOICE = {"mcq", "degree_to_chord", "chord_to_degree", "relative_minor", "interval_inversion", "fill_blank",
          "ear_degree", "ear_quality"}
TS = re.compile(r"^\d{1,2}:\d{2}(:\d{2})?$")
# DESIGN §4 generic patterns (escaped so this file does not match itself)
GENERIC = re.compile("\u20aa|\u05e9\"\u05d7|\u05e9\u05e7\u05dc|\u05de\u05d6\u05d5\u05de\u05df|\u05d0\u05e9\u05e8\u05d0\u05d9|\u05ea\u05e9\u05dc\u05d5\u05dd|\u05db\u05ea\u05d5\u05d1\u05ea|\u05e8\u05d7\u05d5\u05d1" + r"|0\d{1,2}-?\d{7}|\+97\x32|[\w.+-]+@[\w-]+\.[a-z]{2,}", re.I)
AUDIO = (".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac", ".opus", ".webm")
TEXT = (".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".md", ".txt", ".py")

LETTERS = "CDEFGAB"
SEMIS = [0, 2, 4, 5, 7, 9, 11]
MAJOR = [0, 2, 4, 5, 7, 9, 11]
QUAL = ["", "m", "m", "", "", "m", "ø"]
OPEN = {6: 4, 5: 9, 4: 2, 3: 7, 2: 11, 1: 4}   # open-string pitch classes E A D G B E
ACC = {"#": 1, "♯": 1, "b": -1, "♭": -1, "𝄪": 2, "𝄫": -2}
ACC_OUT = {-2: "𝄫", -1: "♭", 0: "", 1: "#", 2: "𝄪"}
FAMILY = {1: "tonic", 6: "tonic", 3: "tonic", 4: "subdominant", 2: "subdominant", 5: "dominant", 7: "dominant"}
TONES = {"": [0, 4, 7], "m": [0, 3, 7], "ø": [0, 3, 6, 10], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11],
         "m7": [0, 3, 7, 10], "°7": [0, 3, 6, 9], "°": [0, 3, 6], "5": [0, 7]}
INT_NUM = {"סקונדה": 2, "טרצה": 3, "קוורטה": 4, "קווינטה": 5, "סקסטה": 6, "ספטימה": 7}


def parse_note(s):
    m = re.match(r"^([A-G])([#♯b♭𝄪𝄫]*)", s)
    l = LETTERS.index(m.group(1))
    acc = sum(ACC[c] for c in m.group(2))
    return l, acc, (SEMIS[l] + acc) % 12, m.end()


def spell(l, pc):
    l %= 7
    acc = (pc - SEMIS[l]) % 12
    if acc > 6:
        acc -= 12
    return LETTERS[l] + ACC_OUT[acc]


def scale(key):
    l, _, pc, _ = parse_note(key)
    return [spell(l + i, pc + MAJOR[i]) for i in range(7)]


def chord(key, d):
    return scale(key)[d - 1] + QUAL[d - 1]


def norm(c):
    return str(c).replace("♯", "#").replace("b", "♭") if re.match(r"^[A-G]b", str(c)) else str(c).replace("♯", "#")


def degree_of(key, ch):
    chords = [chord(key, d) for d in range(1, 8)]
    return chords.index(norm(ch)) + 1 if norm(ch) in chords else 0


def rel_minor(major):
    l, _, pc, _ = parse_note(major)
    return spell(l - 2, pc - 3) + "m"


def rel_major(minor):
    l, _, pc, _ = parse_note(minor.rstrip("m"))
    return spell(l + 2, pc + 3)


def chord_pcs(label):
    """'A7' -> (root pc, {pcs}). None when the name or suffix is unknown."""
    base = str(label).strip()
    if not re.match(r"^[A-G]", base):
        return None
    _, _, root, end = parse_note(base)
    suf = base[end:]
    if suf not in TONES:
        return None
    return root, {(root + t) % 12 for t in TONES[suf]}


def parse_iv(s):
    num = next((v for k, v in INT_NUM.items() if k in s), 0)
    q = "גדולה" if "גדולה" in s else "קטנה" if "קטנה" in s else ""
    return num, q


def check_clip(clip, err):
    """A plain label ('Am') must sound exactly its chord tones, root lowest. A '+' label ('G+C' = G chord with
    C on top, 'G + D' = an interval) must sound every part's root, nothing outside the parts' chords, and the
    first part's root lowest."""
    for ev in clip.get("events", []):
        label = str(ev.get("label", ""))
        notes = ev.get("notes") or []
        parts = [chord_pcs(x) for x in label.split("+")]
        if not notes or not all(parts):
            err(f"clip event {label!r}: unknown chord or no notes")
            continue
        pcs = {n % 12 for n in notes}
        if "+" in label:
            allowed = set().union(*(t for _, t in parts))
            if not {r for r, _ in parts} <= pcs:
                err(f"clip event {label}: a named note is not sounded")
            if pcs - allowed:
                err(f"clip event {label}: tones {sorted(pcs - allowed)} outside the label")
        else:
            root, tones = parts[0]
            if tones - pcs:
                err(f"clip event {label}: missing chord tones {sorted(tones - pcs)}")
            if pcs - tones:
                err(f"clip event {label}: extra tones {sorted(pcs - tones)} (name a melody note with '+')")
        if min(notes) % 12 != parts[0][0]:
            err(f"clip event {label}: lowest note is not the root")


def check_shell(errors, fix):
    sw_path = os.path.join(APP, "sw.js")
    src = open(sw_path, encoding="utf-8").read()
    block = src.split("SHELL_FILES = [", 1)[1].split("];", 1)[0]
    files = re.findall(r'^\s*"([^"]+)",?$', block, re.M)
    listed = set(files)
    need = []
    for sub, exts in (("js", (".js",)), ("css", (".css",)), ("icons", (".svg", ".png"))):
        for root, _, fs in os.walk(os.path.join(APP, sub)):
            for f in fs:
                if f.endswith(exts):
                    need.append(os.path.relpath(os.path.join(root, f), APP).replace(os.sep, "/"))
    for f in sorted(need):
        if f not in listed:
            errors.append(f"sw.js: {f} missing from SHELL_FILES (would only load online)")
    for f in files:
        if f != "./" and not os.path.exists(os.path.join(APP, f)):
            errors.append(f"sw.js: SHELL_FILES lists missing file {f}")
    h = hashlib.sha256()
    for f in files:
        p = os.path.join(APP, "index.html" if f == "./" else f)
        if os.path.exists(p):
            h.update(f.encode() + b"\0" + open(p, "rb").read())
    want = h.hexdigest()[:10]
    m = re.search(r'const SHELL = "gl-shell-([0-9a-z]+)"', src)
    if not m or m.group(1) != want:
        if fix:
            src = re.sub(r'const SHELL = "gl-shell-[0-9a-z]+"', f'const SHELL = "gl-shell-{want}"', src)
            open(sw_path, "w", encoding="utf-8").write(src)
            print(f"fixed: sw.js SHELL = gl-shell-{want}")
        else:
            errors.append(f"sw.js: SHELL must be gl-shell-{want} (shell files changed; run tools/check.py --fix)")
    # every module preloaded from index.html, nothing stale
    html = open(os.path.join(APP, "index.html"), encoding="utf-8").read()
    pre = set(re.findall(r'<link rel="modulepreload" href="([^"]+)">', html))
    mods = {f for f in need if f.endswith(".js")}
    for f in sorted(mods - pre):
        errors.append(f"index.html: no modulepreload for {f}")
    for f in sorted(pre - mods):
        errors.append(f"index.html: modulepreload for missing module {f}")


def main():
    fix = "--fix" in sys.argv[1:]
    errors = []
    idx = json.load(open(os.path.join(LESSONS, "index.json"), encoding="utf-8"))
    listed = {l["file"] for l in idx["lessons"]}
    present = {f for f in os.listdir(LESSONS) if f.endswith(".json") and f != "index.json"}
    for f in sorted(present - listed):
        errors.append(f"index.json: lesson file {f} is not listed")
    for f in sorted(listed - present):
        errors.append(f"index.json: listed {f} does not exist")
    skills = {}
    total = 0
    for entry in idx["lessons"]:
        path = os.path.join(LESSONS, entry["file"])
        if not os.path.exists(path):
            continue
        lesson = json.load(open(path, encoding="utf-8"))
        if lesson.get("id") != entry["id"]:
            errors.append(f"{entry['file']}: id {lesson.get('id')} != index id {entry['id']}")
        for s in lesson.get("skills", []):
            skills[s["id"]] = s
        ids = set()
        for u in lesson.get("units", []):
            for e in u.get("exercises", []):
                total += 1
                eid = f"{entry['id']}/{e.get('id')}"
                err = lambda msg: errors.append(f"{eid}: {msg}")
                if e.get("id") in ids:
                    err("duplicate id")
                ids.add(e.get("id"))
                t = e.get("type")
                if t not in KNOWN:
                    err(f"unknown type {t}")
                    continue
                if e.get("skill") not in skills:
                    err(f"unknown skill {e.get('skill')}")
                if not (e.get("bonus") is True or TS.match(str(e.get("source_ts", "")))):
                    err(f"bad source_ts {e.get('source_ts')}")
                if e.get("difficulty") not in (1, 2, 3):
                    err(f"bad difficulty {e.get('difficulty')}")
                if t in CHOICE and str(e.get("answer")) not in [str(o) for o in e.get("options", [])]:
                    err("answer not in options")
                try:
                    if t == "degree_to_chord" and chord(e["key"], e["degree"]) != norm(e["answer"]):
                        err(f"theory: {e['key']} degree {e['degree']} is {chord(e['key'], e['degree'])}")
                    if t == "chord_to_degree" and degree_of(e["key"], e["chord"]) != int(e["answer"]):
                        err(f"theory: {e['chord']} in {e['key']} is degree {degree_of(e['key'], e['chord'])}")
                    if t == "relative_minor":
                        want = rel_major(e["given"]) if e["direction"] == "minor_to_major" else rel_minor(e["given"])
                        if want != norm(e["answer"]):
                            err(f"theory: relative of {e['given']} is {want}")
                    if t == "progression_build":
                        for i, d in enumerate(e["pattern"]):
                            if chord(e["key"], d) != norm(e["answer"][i]):
                                err(f"theory: slot {i + 1} should be {chord(e['key'], d)}")
                        for c in e["answer"]:
                            if c not in e["pool"]:
                                err(f"answer chord {c} missing from pool")
                    if t == "family_sort":
                        bucket_ids = {b["id"] for b in e["buckets"]}
                        for it in e["items"]:
                            if chord(e["key"], it["degree"]) != norm(it["chord"]):
                                err(f"theory: {it['chord']} is not degree {it['degree']} of {e['key']}")
                            if it["family"] != FAMILY[it["degree"]] or it["family"] not in bucket_ids:
                                err(f"family of degree {it['degree']} is {FAMILY[it['degree']]}")
                    for c in e.get("clips") or []:
                        check_clip(c, err)
                    if t == "ear_degree":
                        evs = e["clips"][0]["events"]
                        if evs[0]["label"] != chord(e["key"], 1):
                            err(f"ear_degree: first event {evs[0]['label']} is not the tonic {chord(e['key'], 1)}")
                        if evs[-1]["label"] != chord(e["key"], int(e["answer"])):
                            err(f"ear_degree: last event {evs[-1]['label']} is not degree {e['answer']} ({chord(e['key'], int(e['answer']))})")
                    if t == "interval_inversion":
                        (n1, q1), (n2, q2) = parse_iv(e["given"]), parse_iv(e["answer"])
                        if n1 + n2 != 9:
                            err(f"inversion: {e['given']} + {e['answer']} = {n1 + n2}, not 9")
                        if {q1, q2} not in ({""}, {"גדולה", "קטנה"}):
                            err(f"inversion: quality must flip (גדולה↔קטנה): {e['given']} → {e['answer']}")
                    if t == "fretboard_find":
                        fa, fb = e.get("frets", [0, 12])
                        if not e.get("answers"):
                            err("no answers")
                        for a in e.get("answers", []):
                            if a["string"] not in e["strings"]:
                                err(f"answer on string {a['string']} not allowed")
                            if not (fa <= a["fret"] <= fb):
                                err(f"answer fret {a['fret']} outside {fa}-{fb}")
                            pc = (OPEN[a["string"]] + a["fret"]) % 12
                            tg = e["target"]
                            if "note" in tg and parse_note(tg["note"])[2] != pc:
                                err(f"answer pitch is not {tg['note']}")
                            if "key" in tg:
                                sc = [parse_note(n)[2] for n in scale(tg["key"])]
                                if pc not in sc or sc.index(pc) + 1 != tg["degree"]:
                                    err(f"answer is not degree {tg['degree']} of {tg['key']}")
                except Exception as x:  # noqa: BLE001
                    err(f"check crashed: {x!r}")
        for u in lesson.get("units", []):
            for c in u.get("ask", []):
                if c.get("skill") not in skills:
                    errors.append(f"{entry['id']}/{u['id']}/ask/{c.get('id')}: unknown skill {c.get('skill')}")
                for clip in (c.get("example") or {}).get("clips") or []:
                    check_clip(clip, lambda msg, cid=c.get("id"), uid=u["id"]: errors.append(f"{entry['id']}/{uid}/ask/{cid}: {msg}"))

    # privacy
    terms = []
    if os.path.exists(TERMS):
        terms = [t.strip() for t in open(TERMS, encoding="utf-8").read().splitlines() if t.strip()]
    scanned = 0
    for root, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in (".git", "shots", "node_modules")]
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, APP)
            if f.lower().endswith(AUDIO):
                errors.append(f"privacy: audio file {rel}")
            if not f.lower().endswith(TEXT):
                continue
            text = open(p, encoding="utf-8", errors="replace").read()
            text = text.replace('\\"', '"')
            text = re.sub(r"gl-shell-[0-9a-z]+", "gl-shell-hash", text)   # the content hash is not a phone number
            scanned += 1
            for m in GENERIC.finditer(text):
                errors.append(f"privacy: {rel}: generic pattern {m.group(0)!r}")
            for t in terms:
                if t in text:
                    errors.append(f"privacy: {rel}: private term {t!r}")

    check_shell(errors, fix)
    print(f"lessons: {len(listed)} · exercises: {total} · skills: {len(skills)} · text files scanned: {scanned} · private terms: {len(terms)}")
    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        for e in errors:
            print("  " + e)
        sys.exit(1)
    print("OK: 0 problems")


if __name__ == "__main__":
    main()
