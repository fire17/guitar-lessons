# מספרים על הצוואר

A Hebrew, RTL, mobile-first guitar course built from real lessons: Duolingo-style units, a fretboard you tap,
ear training with synthesized plucked strings (Karplus-Strong, no audio files), lesson notes, an "ask the
teacher" panel, and practice tools (progression player, speed drill, fretboard explorer, songbook in degrees,
metronome). Static site, plain HTML/CSS/JS ES modules, no build step. Spec: `../private/DESIGN.md` (kept outside
this folder: it is a working document, not part of the public build).

## Run

```
python3 -m http.server 8765        # from this folder; ES modules need http(s), not file://
open http://localhost:8765/#/
```

Dev helpers: `#/dev` (validator, privacy scan, Karplus-Strong pitch test), `?nostorage=1` (storage failure path),
`?nosw=1` (unregister the service worker and clear its caches).

## Add a lesson

1. Write `data/lessons/<date>.json` in the same schema as `2026-10-02.json` (reuse skill ids to feed the same
   mastery rings; the optional fields `notes_md`, `ask[]`, `homework[]`, `open_questions[]`, `goal_he`,
   `chords_table_md` are described in DESIGN §3.4).
2. Append `{ "id": "<date>", "file": "<date>.json" }` to `data/lessons/index.json`.
3. `python3 tools/check.py` must print `OK: 0 problems`, and `#/dev` must show `errors: 0`.

After editing any file in the app shell (HTML/CSS/JS/icons), run `python3 tools/check.py --fix`: it rewrites the
service-worker cache name to the shell's content hash, so returning users get the update. `check.py` fails until
you do, and also fails when a new module is missing from `sw.js` or from the `modulepreload` list in `index.html`.

No code change is needed unless the lesson uses a new exercise type.

## Privacy (public build)

No prices, places, schedules, phone numbers or emails; no recordings of the teacher; the teacher is only
"המורה" / "יונתן"; the student's name appears only inside the app UI. `tools/check.py` scans every text file
here with the generic patterns of DESIGN §4 and, when present, the private terms list kept outside this folder.
