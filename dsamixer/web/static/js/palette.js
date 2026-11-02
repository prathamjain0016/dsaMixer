// Command palette (⌘K / Ctrl+K): fuzzy search over navigation, actions and the 507 questions.
import { $, esc, today as todayStr, addDays, fmtDay, shared } from "./util.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { DiffPill } from "./components/index.js";

const NAV = [
  ["today", "Today", "today"], ["week", "Week", "week"], ["sprint", "Sprint", "sprint"], ["stats", "Stats", "stats"],
  ["questions", "Questions", "list"], ["contests", "Contests", "trophy"], ["ai", "AI course", "sparkle"], ["settings", "Settings", "gear"],
];

let questions = null;
let commands = () => []; // set by main.js: global actions (theme, timer, ...)
export const setCommands = (fn) => { commands = fn; };

/** Subsequence match with a bonus for contiguous runs and word starts. Returns {score, idx} or null. */
export function fuzzy(q, text) {
  if (!q) return { score: 0, idx: [] };
  const t = text.toLowerCase(), s = q.toLowerCase();
  const at = t.indexOf(s);
  if (at >= 0) return { score: 100 - at + (at === 0 || t[at - 1] === " " ? 30 : 0) - t.length / 50, idx: [...Array(s.length).keys()].map((i) => i + at) };
  let score = 0, ti = 0, prev = -2;
  const idx = [];
  for (const ch of s) {
    if (ch === " ") continue;
    ti = t.indexOf(ch, ti);
    if (ti < 0) return null;
    score += ti === prev + 1 ? 5 : 1;
    if (ti === 0 || t[ti - 1] === " ") score += 3;
    idx.push(ti);
    prev = ti++;
  }
  return { score: score - t.length / 50, idx };
}
const mark = (text, idx) => { const set = new Set(idx); return [...text].map((c, i) => (set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c))).join(""); };

/** Parse "2026-11-05", "tomorrow", "yesterday", "today", "+3", "-1" into an ISO date. */
function parseDate(q) {
  const s = q.trim().toLowerCase().replace(/^(go to|goto|day)\s+/, "");
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return s;
  if (s === "today") return todayStr();
  if (s === "tomorrow") return addDays(todayStr(), 1);
  if (s === "yesterday") return addDays(todayStr(), -1);
  const m = s.match(/^([+-]\d{1,3})$/);
  return m ? addDays(todayStr(), +m[1]) : null;
}

export function openPalette() {
  if ($("dialog.palette")) return;
  const dlg = document.createElement("dialog");
  dlg.className = "palette";
  dlg.setAttribute("aria-label", "Command palette");
  dlg.innerHTML = `<div class="pal-input">${icon("search")}<input type="text" id="palQ" placeholder="Type a command, page, date or question…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palList"></div>
    <div class="pal-list" id="palList" role="listbox"></div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>Esc</kbd> close</span><span style="margin-left:auto">Try “tomorrow” or a question title</span></div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("mousedown", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  const input = $("#palQ", dlg), list = $("#palList", dlg);
  let items = [], sel = 0, dateMode = false;

  if (!questions) api("/questions").then((q) => { questions = q; if (dlg.open) draw(); }).catch(() => {});

  function build(q) {
    if (dateMode) {
      const d = parseDate(q) || (/^\d{4}-\d\d-\d\d$/.test(q) ? q : null);
      return d ? [{ group: "Go to date", label: `Open ${fmtDay(d)}`, icon: "calendar", run: () => (location.hash = `#/today/${d}`) }] : [];
    }
    const out = [];
    const d = parseDate(q);
    if (d) out.push({ group: "Go to date", label: `Open ${fmtDay(d)}`, hint: d, icon: "calendar", score: 999, run: () => (location.hash = d === todayStr() ? "#/today" : `#/today/${d}`) });
    const add = (group, list, cap) => {
      const scored = list.map((it) => ({ ...it, group, m: fuzzy(q, it.match || it.label) })).filter((it) => it.m)
        .sort((a, b) => b.m.score - a.m.score).slice(0, cap);
      out.push(...scored);
    };
    add("Navigation", NAV.map(([r, l, ic]) => ({ label: `Go to ${l}`, match: `${l} go to`, icon: ic, run: () => (location.hash = `#/${r}`) })), q ? 4 : 8);
    add("Actions", [
      ...commands(),
      { label: "Go to date…", icon: "calendar", keep: true, run: () => { dateMode = true; input.value = ""; input.placeholder = "YYYY-MM-DD, tomorrow, +3…"; input.type = "text"; draw(); } },
    ], q ? 5 : 10);
    if (q && questions) {
      add("Questions", questions.map((x) => ({
        label: x.title, match: `${x.title} ${x.section} ${x.subtopic || ""} ${x.pattern || ""}`, icon: "book",
        hint: `${DiffPill(x.difficulty)} <span>${esc(x.section)}</span>`, hintHtml: true,
        run: () => { if (x.url) window.open(x.url, "_blank", "noopener"); else { shared.questionSearch = x.title; location.hash = "#/questions"; } },
      })), 8);
    }
    return out;
  }

  function draw() {
    const q = input.value.trim();
    items = build(q);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let last = null;
    list.innerHTML = items.length ? items.map((it, i) => {
      const head = it.group !== last ? `<div class="pal-group">${esc(it.group)}</div>` : "";
      last = it.group;
      const lm = q && !dateMode ? fuzzy(q, it.label) : null;
      const label = lm ? mark(it.label, lm.idx) : esc(it.label);
      return `${head}<div class="pal-item" role="option" id="pi${i}" data-i="${i}" aria-selected="${i === sel}">${icon(it.icon || "arrow")}<span class="pi-label">${label}</span>${it.hint ? `<span class="pi-hint">${it.hintHtml ? it.hint : esc(it.hint)}</span>` : ""}${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ""}</div>`;
    }).join("") : `<div class="pal-empty">${dateMode ? "Type a date like 2026-11-05, tomorrow or +3" : questions || !q ? "No matches" : "Loading questions…"}</div>`;
    input.setAttribute("aria-activedescendant", items.length ? `pi${sel}` : "");
  }
  const move = (d) => { if (!items.length) return; sel = (sel + d + items.length) % items.length; draw(); $(`#pi${sel}`, list)?.scrollIntoView({ block: "nearest" }); };
  const choose = (i) => { const it = items[i]; if (!it) return; if (!it.keep) dlg.close(); it.run(); };
  input.addEventListener("input", () => { sel = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
  });
  list.addEventListener("mousemove", (e) => { const it = e.target.closest(".pal-item"); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; draw(); } });
  list.addEventListener("click", (e) => { const it = e.target.closest(".pal-item"); if (it) choose(+it.dataset.i); });
  draw();
  input.focus();
}
