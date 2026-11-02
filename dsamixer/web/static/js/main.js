// App shell: hash router, sidebar (collapsible rail / mobile drawer), top bar crumbs, theme, streak,
// running-timer pill, command palette wiring.
import { $, $$, parseHash, lsGet, lsSet, debounce, fmtDay, shared } from "./util.js";
import { api } from "./api.js";
import { icon, initTooltips } from "./ui.js";
import { initKeys, openHelp, setViewKeys } from "./keys.js";
import { openPalette, setCommands } from "./palette.js";
import { toast } from "./components/index.js";
import * as timer from "./timer.js";

const VIEWS = {
  today: () => import("./views/today.js"), week: () => import("./views/week.js"), sprint: () => import("./views/sprint.js"),
  stats: () => import("./views/stats.js"), contests: () => import("./views/contests.js"), questions: () => import("./views/questions.js"),
  ai: () => import("./views/ai.js"), settings: () => import("./views/settings.js"),
};
const META = {
  today: ["Today", "today", "Workspace"], week: ["Week", "week", "Workspace"], sprint: ["Sprint", "sprint", "Workspace"], stats: ["Stats", "stats", "Workspace"],
  questions: ["Questions", "list", "Practice"], contests: ["Contests", "trophy", "Practice"], ai: ["AI course", "sparkle", "Course"], settings: ["Settings", "gear", "Workspace"],
};
const ALIAS = { board: "today" }; // old hash names

let current = null, currentName = null, token = 0;
const app = $("#app");

async function route() {
  let { route: name, arg } = parseHash();
  name = ALIAS[name] || name;
  if (!VIEWS[name]) name = "today";
  const want = `#/${name}${arg ? "/" + arg : ""}`;
  if (location.hash !== want) history.replaceState(null, "", want);
  $$("#sidebar [data-route]").forEach((a) => (a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  paintCrumbs(name, arg);
  app.classList.remove("sb-open");
  const mine = ++token;
  current?.destroy?.();
  current = null;
  currentName = null;
  setViewKeys(null);
  const root = $("#view");
  root.innerHTML = "";
  const mod = await VIEWS[name]();
  if (mine !== token) return;
  root.className = "view-enter";
  try { await mod.render(root, arg); current = mod; currentName = name; }
  catch (e) { console.error(e); root.innerHTML = `<div class="banner warn">${icon("alert")}<span>Couldn't load this view: ${String(e.message || e)}</span></div>`; }
  window.scrollTo(0, 0);
}

function paintCrumbs(name, arg) {
  const [label, ic, group] = META[name];
  const extra = arg && /^\d{4}-\d\d-\d\d$/.test(arg) ? `<span class="sep">/</span><span>${fmtDay(arg, { weekday: "short", day: "numeric", month: "short" })}</span>` : "";
  $("#crumbs").innerHTML = `<span>${group}</span><span class="sep">/</span>${icon(ic)}<b>${label}</b>${extra}`;
  document.title = `${label} · dsaMixer`;
}

// ---------- sidebar ----------
const mobile = matchMedia("(max-width: 767px)");
function applySidebar() {
  const collapsed = lsGet("dsm.sidebar") === "collapsed" && !mobile.matches;
  app.classList.toggle("sb-collapsed", collapsed);
  document.documentElement.classList.remove("pre-collapsed");
  const b = $("#sbCollapse");
  b.innerHTML = icon("sidebar");
  b.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  b.dataset.tip = collapsed ? "Expand sidebar" : "Collapse sidebar";
  $$("#sidebar .sb-item").forEach((a) => (collapsed ? (a.dataset.tip = a.querySelector(".sb-label").textContent) : delete a.dataset.tip));
}
$("#sbCollapse").onclick = () => { lsSet("dsm.sidebar", app.classList.contains("sb-collapsed") ? "open" : "collapsed"); applySidebar(); };
mobile.addEventListener?.("change", applySidebar);
$("#menuBtn").onclick = () => app.classList.add("sb-open");
$("#scrim").onclick = () => app.classList.remove("sb-open");
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && app.classList.contains("sb-open")) app.classList.remove("sb-open"); });

// ---------- theme ----------
const effectiveTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function paintThemeBtn() { $("#themeBtn").innerHTML = icon(effectiveTheme() === "dark" ? "sun" : "moon"); }
function toggleTheme() {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  lsSet("theme", next);
  paintThemeBtn();
}
$("#themeBtn").onclick = toggleTheme;

// ---------- streak ----------
const refreshStreak = debounce(async () => {
  try {
    const s = await api("/stats");
    $("#streakN").textContent = s.streak;
    $("#streakWord").textContent = "day streak";
  } catch { /* offline: keep the old value */ }
}, 300);
document.addEventListener("dsm:changed", refreshStreak);

// ---------- timer pill ----------
function paintTimer() {
  const t = timer.get(), el = $("#timerPill");
  el.hidden = !t;
  if (!t) return;
  el.classList.toggle("paused", !t.startedAt);
  $("#timerClock").textContent = timer.clockText(t);
  $("#timerTitle").textContent = t.title;
  el.setAttribute("aria-label", `Timer ${t.startedAt ? "running" : "paused"} on ${t.title}. Open the card`);
  el.dataset.tip = app.classList.contains("sb-collapsed") ? `${timer.clockText(t)} · ${t.title}` : "";
  if (!el.dataset.tip) delete el.dataset.tip;
}
$("#timerPill").onclick = () => {
  const t = timer.get();
  if (t) runAction({ open: t.ticketId }, t.date);
};
timer.onChange(paintTimer);
setInterval(paintTimer, 1000);

/** Run a Today action (new card, pull, close day, timer, open a card): on Today now, or after navigating there. */
function runAction(action, date) {
  const target = date || null;
  const onToday = currentName === "today" && (!target || current?.currentDate?.() === target);
  if (onToday) return document.dispatchEvent(new CustomEvent("dsm:action", { detail: action }));
  shared.pendingAction = action;
  location.hash = target ? `#/today/${target}` : "#/today";
}

setCommands(() => [
  { label: "New card", icon: "plus", kbd: "N", run: () => runAction("newCard") },
  { label: "Pull next question", icon: "pull", kbd: "P", run: () => runAction("pull") },
  { label: "Close day", icon: "check", kbd: "C", run: () => runAction("closeDay") },
  { label: timer.isRunning() ? "Pause timer" : "Start / resume timer", icon: timer.isRunning() ? "pause" : "play", kbd: "Space", run: () => {
    const t = timer.get();
    if (t && t.startedAt) { timer.pause(); toast("Timer paused"); }
    else if (t) { timer.start({ id: t.ticketId, date: t.date, title: t.title }); toast("Timer resumed"); }
    else runAction("toggleTimer");
  } },
  { label: `Switch to ${effectiveTheme() === "dark" ? "light" : "dark"} theme`, icon: effectiveTheme() === "dark" ? "sun" : "moon", run: toggleTheme },
  { label: "Toggle sidebar", icon: "sidebar", run: () => $("#sbCollapse").click() },
  { label: "Keyboard shortcuts", icon: "help", kbd: "?", run: openHelp },
]);

// ---------- boot ----------
$$("[data-icon]").forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
$("#helpBtn").innerHTML = icon("help");
$("#menuBtn").innerHTML = icon("menu");
applySidebar();
paintThemeBtn();
paintTimer();
initTooltips();
initKeys((name) => { location.hash = `#/${name}`; }, openPalette);
$("#helpBtn").onclick = openHelp;
$("#searchBtn").onclick = openPalette;
$("#sbSearch").onclick = openPalette;
window.addEventListener("hashchange", route);
refreshStreak();
route();
