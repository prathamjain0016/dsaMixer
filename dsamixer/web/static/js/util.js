// Small shared helpers: DOM, dates, formatting, safe localStorage, cross-view state.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = (s) => { const d = new Date(s + "T00:00:00"); return addDays(s, -((d.getDay() + 6) % 7)); };
export const fmtDay = (s, opts = { weekday: "long", day: "numeric", month: "short" }) => new Date(s + "T00:00:00").toLocaleDateString(undefined, opts);
export const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`);
export const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
};
export const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: fine */ }
}
export function lsGetJson(key, fallback = null) {
  try { return JSON.parse(lsGet(key, "null")) ?? fallback; } catch { return fallback; }
}

export const KIND_LABEL = { dsa: "DSA", review: "Review", ai: "AI", contest: "Contest", upsolve: "Upsolve", retro: "Retro", custom: "Task" };
export const LOGGABLE = ["dsa", "review", "upsolve"];
export const STATUSES = ["todo", "doing", "done", "skipped"];
export const STATUS_LABEL = { todo: "To do", doing: "In progress", done: "Done", skipped: "Skipped" };
export const LANES = [
  { id: "dsa", name: "DSA", kinds: ["dsa", "review", "upsolve"], always: true },
  { id: "ai", name: "AI course", kinds: ["ai"] },
  { id: "other", name: "Contests & other", kinds: ["contest", "retro", "custom"] },
];
export const laneOf = (kind) => LANES.find((l) => l.kinds.includes(kind)) || LANES[2];

// State shared across views (kept out of the URL).
export const shared = { contestPrefill: null, pendingAction: null, questionSearch: null };

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [route, ...rest] = raw.split("/");
  return { route: route || "today", arg: rest.join("/") || null };
}
