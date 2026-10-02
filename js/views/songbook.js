// songbook.js: songs written in degrees + decode mode (DESIGN §14.4)
import { h, richText, iconEl, toast } from "../dom.js";
import * as T from "../theory.js";
import * as store from "../store.js";
import * as audio from "../audio.js";
import { ProgressionEngine, keyChips, seg } from "./tools.js";
import { confirmSheet } from "../sheet.js";

const SECTION_NAMES = ["בית", "פזמון", "חלק ב'"];

export function chordForToken(key, tok) {
  const d = Number(String(tok)[0]);
  const mod = String(tok).slice(1);
  if (!(d >= 1 && d <= 7)) return "?";
  const sc = T.majorScale(key);
  const root = sc[d - 1].name;
  const q = T.QUAL[d - 1];
  if (mod === "m") return root + "m";
  if (mod === "7") return root + "7";
  return root + q;
}

export function renderSongbook(main, query, cleanup) {
  let mode = "write";
  const page = h("div", { class: "page tool-page songbook" });
  main.appendChild(page);
  let eng = null;
  cleanup.push(() => { if (eng) eng.stop(); });
  list();

  function header() {
    return h("div", { class: "sb-head" },
      h("p", { class: "muted small", html: richText("\"הכי חשוב לכתוב שירים על הדרגות\" (⏱ 1:30:04). ככה אפשר להחליט אילו אקורדים לשים, וגם לפענח שירים של אחרים.") }),
      seg([["write", "שירים שלי"], ["decode", "פענוח"]], mode, (v) => { mode = v; v === "write" ? list() : decode(); }, "מצב"));
  }

  function list() {
    if (eng) eng.stop();
    page.innerHTML = "";
    page.appendChild(header());
    const songs = store.get().songs;
    const ul = h("div", { class: "song-list" });
    if (!songs.length) ul.appendChild(h("p", { class: "muted" }, "עוד אין שירים. אפשר להתחיל מהדוגמה: ארבעת האקורדים וחלק ב' שלהם."));
    songs.forEach((s) => {
      ul.appendChild(h("button", { type: "button", class: "song-card", onclick: () => edit(s.id) },
        h("b", null, s.title || "שיר בלי שם"),
        h("small", { dir: "rtl" }, `סולם `, h("bdi", { dir: "ltr" }, s.key), ` · ${s.sections.map((x) => `${x.name}: ${x.degrees.join("-") || "…"}`).join(" · ")}`)));
    });
    const add = h("button", { type: "button", class: "btn btn-primary btn-block" }, iconEl("plus", 18), " שיר חדש");
    add.addEventListener("click", () => {
      const s = { id: "s" + Date.now().toString(36), title: "", key: "G", sections: [{ name: "בית", degrees: [], cpb: 1 }] };
      store.saveSong(s);
      edit(s.id);
    });
    const ex = h("button", { type: "button", class: "btn btn-secondary btn-block" }, "דוגמה: 1-5-6-4 וחלק ב' 6-4-1-5");
    ex.addEventListener("click", () => {
      const s = { id: "s" + Date.now().toString(36), title: "ארבעת האקורדים", key: "G", sections: [{ name: "בית", degrees: ["1", "5", "6", "4"], cpb: 1 }, { name: "חלק ב'", degrees: ["6", "4", "1", "5"], cpb: 1 }] };
      store.saveSong(s);
      edit(s.id);
    });
    page.append(ul, h("div", { class: "btn-col" }, add, ex));
  }

  function edit(id) {
    if (eng) eng.stop();
    const song = store.get().songs.find((s) => s.id === id);
    if (!song) return list();
    page.innerHTML = "";
    let activeSec = 0;
    let modifier = "";
    const save = () => store.saveSong(song);
    const title = h("input", { type: "text", class: "text-input title-input", value: song.title, placeholder: "שם השיר", "aria-label": "שם השיר" });
    title.addEventListener("input", () => { song.title = title.value; save(); });
    const secWrap = h("div", { class: "sections" });
    const paint = () => {
      secWrap.innerHTML = "";
      song.sections.forEach((sec, si) => {
        const chips = h("div", { class: "sec-chords", dir: "ltr" }, sec.degrees.map((tok, ti) => {
          const b = h("button", { type: "button", class: "deg-chip", "aria-label": `מחק ${tok}` }, h("b", null, tok), h("small", null, chordForToken(song.key, tok)));
          b.addEventListener("click", () => { sec.degrees.splice(ti, 1); save(); paint(); });
          return b;
        }));
        const name = h("select", { class: "sec-name", "aria-label": "שם החלק" }, [...new Set([...SECTION_NAMES, sec.name])].map((n) => h("option", { value: n, selected: n === sec.name || null }, n)));
        name.addEventListener("change", () => { sec.name = name.value; save(); });
        const cpbSeg = seg([[1, "1 בתיבה"], [2, "2 בתיבה"]], sec.cpb || 1, (v) => { sec.cpb = v; save(); }, "אקורדים בתיבה");
        const del = h("button", { type: "button", class: "icon-btn sm", "aria-label": "מחק חלק" }, iconEl("trash", 18));
        del.addEventListener("click", () => { song.sections.splice(si, 1); if (!song.sections.length) song.sections.push({ name: "בית", degrees: [], cpb: 1 }); activeSec = 0; save(); paint(); });
        const card = h("div", { class: `sec-card ${si === activeSec ? "active" : ""}` }, h("div", { class: "sec-top" }, name, cpbSeg, del), chips.children.length ? chips : h("p", { class: "muted small" }, "הקש מספרים במקלדת למטה"));
        card.addEventListener("click", (e) => { if (e.target.closest("button, select")) return; activeSec = si; paint(); });
        secWrap.appendChild(card);
      });
    };
    const pad = h("div", { class: "keypad", dir: "ltr" }, [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const b = h("button", { type: "button", class: "key-btn" }, h("b", null, String(d)), h("small", { class: "kp-chord" }, ""));
      b.addEventListener("click", () => {
        song.sections[activeSec].degrees.push(String(d) + modifier);
        modifier = ""; paintMods(); save(); paint();
      });
      return b;
    }));
    const paintPad = () => pad.querySelectorAll(".key-btn").forEach((b, i) => { b.querySelector(".kp-chord").textContent = chordForToken(song.key, String(i + 1) + modifier); });
    const mods = h("div", { class: "chips-row" });
    const paintMods = () => {
      mods.innerHTML = "";
      [["", "רגיל"], ["m", "m"], ["7", "7 (דומיננטה)"]].forEach(([v, t]) => {
        const b = h("button", { type: "button", class: "chip-btn", "aria-pressed": String(modifier === v) }, t);
        b.addEventListener("click", () => { modifier = v; paintMods(); });
        mods.appendChild(b);
      });
      paintPad();
    };
    paintMods();
    const addSec = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, iconEl("plus", 16), " חלק");
    addSec.addEventListener("click", () => { const used = song.sections.map((s) => s.name); song.sections.push({ name: SECTION_NAMES.find((n) => !used.includes(n)) || "בית", degrees: [], cpb: 1 }); activeSec = song.sections.length - 1; save(); paint(); });
    const playBtn = h("button", { type: "button", class: "btn btn-primary" }, iconEl("play", 18), " נגן");
    const nowPlaying = h("div", { class: "now-playing", "aria-live": "off" });
    playBtn.addEventListener("click", () => {
      audio.ensure();
      if (eng && eng.running) { eng.stop(); playBtn.lastChild.textContent = " נגן"; nowPlaying.textContent = ""; return; }
      // flatten sections; cpb per section → beats per chord (4 or 2)
      const chords = [];
      song.sections.forEach((s) => s.degrees.forEach((tok) => {
        const name = chordForToken(song.key, tok);
        chords.push({ name, tok, sec: s.name, notes: T.voicing(name), beats: (s.cpb || 1) === 2 ? 2 : 4 });
      }));
      if (!chords.length) { toast("אין עדיין אקורדים"); return; }
      eng = ProgressionEngine({ bpm: 80, beatsPerChord: 2, loop: false, onChord: (i, c) => { nowPlaying.innerHTML = ""; nowPlaying.append(h("span", null, c.sec + " · "), h("b", null, c.tok), h("small", { dir: "ltr" }, " " + c.name)); }, onEnd: () => { playBtn.lastChild.textContent = " נגן"; nowPlaying.textContent = ""; } });
      eng.setChords(chords);
      eng.start();
      playBtn.lastChild.textContent = " עצור";
    });
    const back = h("button", { type: "button", class: "btn btn-ghost btn-sm" }, "← לכל השירים");
    back.addEventListener("click", list);
    const del = h("button", { type: "button", class: "btn btn-ghost btn-sm danger" }, "מחק שיר");
    del.addEventListener("click", async () => { if (await confirmSheet({ title: "למחוק את השיר?", yes: "מחק", no: "ביטול", danger: true })) { store.deleteSong(song.id); list(); } });
    page.append(
      h("div", { class: "sb-bar" }, back, del),
      title,
      h("div", { class: "tool-sec" }, h("h3", null, "סולם"), keyChips(song.key, (k) => { song.key = k; save(); paint(); paintPad(); })),
      secWrap,
      h("div", { class: "sb-actions" }, addSec, playBtn),
      nowPlaying,
      h("div", { class: "pad-dock" }, mods, pad));
    paint();
  }

  function decode() {
    if (eng) eng.stop();
    page.innerHTML = "";
    page.appendChild(header());
    let key = "G";
    const input = h("input", { type: "text", class: "text-input", dir: "ltr", placeholder: "G D Em C", "aria-label": "שמות אקורדים, מופרדים ברווח" });
    const out = h("div", { class: "decode-out", dir: "ltr" });
    const paint = () => {
      out.innerHTML = "";
      const toks = input.value.split(/[\s,–-]+/).filter(Boolean);
      toks.forEach((t) => {
        const c = T.parseChord(t);
        const d = c ? T.degreeOf(key, t) : 0;
        const diatonic = d && T.normChord(T.chordOn(key, d)) === T.normChord(t);
        out.appendChild(h("div", { class: `deg-chip ${d ? "" : "out"}` }, h("b", null, d ? String(d) + (diatonic ? "" : "*") : "?"), h("small", null, t)));
      });
      note.hidden = !toks.some((t) => { const d = T.degreeOf(key, t); return !d || T.normChord(T.chordOn(key, d)) !== T.normChord(t); });
    };
    const note = h("p", { class: "muted small", hidden: true }, "* האקורד על הדרגה הזאת לא מהסולם (למשל מז'ור במקום מינור). ? = מחוץ לסולם.");
    input.addEventListener("input", paint);
    page.append(
      h("div", { class: "tool-sec" }, h("h3", null, "אקורדים"), input),
      h("div", { class: "tool-sec" }, h("h3", null, "סולם"), keyChips(key, (k) => { key = k; paint(); })),
      out, note,
      h("p", { class: "muted small", html: richText("למשל: ב-G המהלך G – D – Em – C הוא 1-5-6-4 (⏱ 32:26).") }));
  }
}
