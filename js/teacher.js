// teacher.js: the "שאלה על המושג" hook (DESIGN §13.4). Canned now; an agent can plug in later.
import { DB } from "./data.js";

export const POLICY = "ענה בעברית, קצר וברור, רק מתוך מה שנלמד בשיעורים המצורפים (grounding). צטט ⏱ כשאפשר. אם השאלה מעבר לשיעור, סמן את התשובה [בונוס] או הצע לשאול את יונתן בשיעור הבא. אל תמציא ציטוטים של המורה.";
export const STUB = "אין עדיין עוזר מחובר. הנה ההסבר מהסיכום, והשאלה נשמרה לשיעור הבא:";

// req = { lesson_id, unit_id, concept_id, question_he, history, grounding: { concept_he, deeper_he, quote_he, notes_md_excerpt, explain_he? }, faq }
export async function ask(req) {
  // 1. injected agent
  if (window.GuitarTeacherAgent && typeof window.GuitarTeacherAgent.ask === "function") {
    try { return await window.GuitarTeacherAgent.ask({ ...req, policy: POLICY }); } catch (e) { console.warn("agent failed", e); }
  }
  // 2. configured endpoint
  const t = DB.config.teacher || {};
  let unavailable = false;
  if (t.mode === "endpoint" && t.url) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(t.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...req, policy: POLICY }), signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) return await r.json();
      unavailable = true;
    } catch (e) { unavailable = true; }
  }
  // 3. canned matcher
  const ans = canned(req);
  if (unavailable) ans.answer_he = "העוזר לא זמין כרגע. " + ans.answer_he;
  return ans;
}

function norm(s) { return String(s || "").replace(/[״"'׳?!.,:;()\-–]/g, " ").replace(/\s+/g, " ").trim(); }

export function canned(req) {
  const q = norm(req.question_he);
  let best = null, bestHits = 0;
  for (const f of req.faq || []) {
    const hits = (f.keywords || []).filter((k) => q.includes(norm(k))).length;
    if (hits > bestHits) { best = f; bestHits = hits; }
  }
  if (best && bestHits >= 1) {
    const ts = String(best.answer_he).match(/⏱\s?(\d{1,2}:\d{2}(?::\d{2})?)/);
    return { answer_he: best.answer_he, cites: ts ? [{ ts: ts[1] }] : [] };
  }
  const g = req.grounding || {};
  const body = g.deeper_he || g.concept_he || g.explain_he || "";
  return { answer_he: `${STUB}\n\n${body}`, cites: [], saved: true };
}
