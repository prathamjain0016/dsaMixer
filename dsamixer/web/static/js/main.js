// App shell: hash router, theme toggle, streak pill, running-timer indicator.
import { $, $$, parseHash, lsGet, lsSet, debounce } from "./util.js";
import { api } from "./api.js";
import { icon, initTooltips } from "./ui.js";
import { initKeys, setViewKeys, TABS, openHelp } from "./keys.js";
import * as timer from "./timer.js";

const VIEWS = {
  today: () => import("./views/today.js"), week: () => import("./views/week.js"), sprint: () => import("./views/sprint.js"),
  stats: () => import("./views/stats.js"), contests: () => import("./views/contests.js"), questions: () => import("./views/questions.js"),
  ai: () => import("./views/ai.js"), settings: () => import("./views/settings.js"),
};
const ALIAS = { board: "today" }; // old hash names

let current = null, token = 0;

async function route() {
  let { route: name, arg } = parseHash();
  name = ALIAS[name] || name;
  if (!VIEWS[name]) name = "today";
  const want = `#/${name}${arg ? "/" + arg : ""}`;
  if (location.hash !== want) { history.replaceState(null, "", want); }
  $$("#nav a").forEach((a) => (a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const mine = ++token;
  current?.destroy?.();
  current = null;
  setViewKeys(null);
  const root = $("#view");
  root.innerHTML = "";
  const mod = await VIEWS[name]();
  if (mine !== token) return;
  root.className = "view-enter";
  try { await mod.render(root, arg); current = mod; } catch (e) { console.error(e); root.innerHTML = `<div class="panel">Couldn't load this view: ${String(e.message || e)}</div>`; }
  window.scrollTo(0, 0);
}

// ---------- theme ----------
const effectiveTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function paintThemeBtn() { $("#themeBtn").innerHTML = icon(effectiveTheme() === "dark" ? "sun" : "moon"); }
$("#themeBtn").onclick = () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  lsSet("theme", next);
  paintThemeBtn();
};

// ---------- streak ----------
const refreshStreak = debounce(async () => {
  try {
    const s = await api("/stats");
    $("#streakN").textContent = s.streak;
    $("#streakWord").textContent = s.streak === 1 ? "day" : "days";
  } catch { /* offline: keep the old value */ }
}, 300);
document.addEventListener("dsm:changed", refreshStreak);

// ---------- timer indicator ----------
function paintTimer() {
  const t = timer.get(), el = $("#timerInd");
  el.hidden = !t;
  if (!t) return;
  el.classList.toggle("paused", !t.startedAt);
  el.href = `#/today/${t.date}`;
  $("#timerClock").textContent = timer.clockText(t);
  $("#timerTitle").textContent = t.title.length > 28 ? t.title.slice(0, 27) + "…" : t.title;
  el.setAttribute("aria-label", `Timer ${t.startedAt ? "running" : "paused"} on ${t.title}`);
}
timer.onChange(paintTimer);
setInterval(paintTimer, 1000);

paintThemeBtn();
$("#streakIcon").innerHTML = icon("flame");
$("#helpBtn").innerHTML = icon("help");
paintTimer();
initTooltips();
initKeys((name) => { location.hash = `#/${name}`; });
$("#helpBtn").onclick = openHelp;
window.addEventListener("hashchange", route);
refreshStreak();
route();
