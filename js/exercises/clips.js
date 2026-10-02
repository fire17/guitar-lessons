// clips.js: clip player for exercises with `clips` (DESIGN §9.3)
import { h, iconEl, announce, toast, richText } from "../dom.js";
import * as audio from "../audio.js";
import * as store from "../store.js";

export function ClipPlayer(clips, { showLabels = false, autoplay = false } = {}) {
  let slow = false;
  let playingIdx = -1;
  let handle = null;
  const btns = [];
  const dots = h("div", { class: "beat-dots", "aria-hidden": "true" }, [0, 1, 2, 3].map(() => h("i")));
  const labelRows = [];

  const el = h("div", { class: "clip-player" });
  const row = h("div", { class: "clip-row" });
  clips.forEach((clip, i) => {
    const btn = h("button", { type: "button", class: "clip-btn", "aria-label": `נגן ${clip.label_he || (clips.length > 1 ? "קטע " + (i + 1) : "את הקטע")}` }, iconEl("play", 28));
    // label_he may carry chords ("A7 → Dm"): isolate them so the arrow keeps its direction inside RTL
    const lab = h("div", { class: "clip-label", html: richText(clip.label_he ? `קטע ${clip.label_he}` : (clips.length > 1 ? `קטע ${i + 1}` : "האזן")) });
    const chips = h("div", { class: "clip-chips", hidden: !showLabels, dir: "ltr" }, clip.events.map((e) => e.label).join(" → "));
    labelRows.push(chips);
    btn.addEventListener("click", () => play(i));
    btns.push(btn);
    row.appendChild(h("div", { class: "clip-cell" }, btn, lab, chips));
  });
  const turtle = h("button", { type: "button", class: "chip-btn turtle", "aria-pressed": "false", title: "האט ל-70%" }, iconEl("turtle", 20), h("span", null, "לאט"));
  turtle.addEventListener("click", () => {
    slow = !slow;
    turtle.setAttribute("aria-pressed", String(slow));
    turtle.classList.toggle("on", slow);
    play(Math.max(0, playingIdx >= 0 ? playingIdx : 0));
  });
  el.append(row, h("div", { class: "clip-tools" }, dots, turtle));

  function setPlaying(i) {
    btns.forEach((b, j) => {
      b.classList.toggle("playing", j === i);
      b.innerHTML = "";
      b.appendChild(iconEl(j === i ? "stop" : "play", 28));
    });
  }

  function play(i) {
    if (store.settings().sound === false) { toast("הצליל כבוי בהגדרות"); return; }
    audio.ensure();
    if (playingIdx === i && handle) { stop(); return; }
    const run = () => {
      stop();
      playingIdx = i;
      setPlaying(i);
      announce("מתנגן");
      const ds = Array.from(dots.children);
      handle = audio.playClip(clips[i], {
        rate: slow ? 0.7 : 1,
        onBeat: (bi) => { ds.forEach((d, j) => d.classList.toggle("on", j === bi % 4)); },
      });
      handle.done.then((finished) => {
        if (playingIdx === i) { playingIdx = -1; setPlaying(-1); ds.forEach((d) => d.classList.remove("on")); }
        if (finished) announce("הסתיים");
      });
    };
    if (!audio.isUnlocked()) {
      toast("הקש כדי להפעיל צליל");
      audio.whenUnlocked(run);
    } else run();
  }
  function stop() { if (handle) handle.stop(); handle = null; playingIdx = -1; setPlaying(-1); }

  const api = {
    el,
    play,
    stop,
    replay() { play(Math.max(0, playingIdx >= 0 ? playingIdx : 0)); },
    revealLabels() { labelRows.forEach((c) => { c.hidden = false; }); },
    labelsText() { return clips.map((c) => c.events.map((e) => e.label).join(" → ")).join(" · "); },
  };
  if (autoplay && audio.isUnlocked() && store.settings().sound !== false) setTimeout(() => play(0), 350);
  return api;
}
