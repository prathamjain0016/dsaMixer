// Global keyboard shortcuts. Views register their own handler with setViewKeys().
import { overlayOpen, openDialog } from "./ui.js";
import { esc } from "./util.js";
import { menuOpen } from "./components/index.js";

export const TABS = ["today", "week", "sprint", "stats", "contests", "questions", "ai", "settings"];
const G = { t: "today", w: "week", r: "sprint", s: "stats", c: "contests", q: "questions", a: "ai", e: "settings" };

export const SHORTCUTS = [
  ["Everywhere", [["⌘K  or  Ctrl K", "Command palette: pages, actions, dates, questions"], ["1 – 8", "Switch page (Today, Week, Sprint, Stats, Contests, Questions, AI course, Settings)"],
    ["g t / w / r / s", "Go to Today / Week / Sprint / Stats"], ["g c / q / a / e", "Go to Contests / Questions / AI course / Settings"], ["?", "Show this help"], ["Esc", "Close any dialog or panel"]]],
  ["Today", [
    ["j / k  or  ↓ / ↑", "Select next / previous card"], ["h / l  or  ← / →", "Move selected card to previous / next column"],
    ["Enter", "Open the card details"], ["x", "Mark selected card done (quick log)"], ["Space", "Start / pause timer (selected card, else Now card)"],
    ["n", "New card"], ["p", "Pull next question"], ["c", "Close day"], ["[  /  ]", "Previous / next day"], [".", "Jump to today"],
  ]],
  ["Week", [["[  /  ]", "Previous / next week"], [".", "Jump to this week"]]],
  ["Questions", [["/", "Focus the search box"]]],
];

let viewHandler = null;
export const setViewKeys = (fn) => { viewHandler = fn; };

const typing = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

export function initKeys(go, palette) {
  let gAt = 0;
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      if (document.querySelector("dialog.palette")) return;
      if (overlayOpen()) return;
      e.preventDefault();
      return palette();
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target) || overlayOpen() || menuOpen()) return;
    if (gAt && Date.now() - gAt < 1200) {
      gAt = 0;
      if (G[e.key]) { e.preventDefault(); return go(G[e.key]); }
    }
    if (e.key === "g") { gAt = Date.now(); return; }
    if (e.key === "?") { e.preventDefault(); return openHelp(); }
    if (/^[1-8]$/.test(e.key)) { e.preventDefault(); return go(TABS[+e.key - 1]); }
    if (viewHandler?.(e)) e.preventDefault();
  });
}

export function openHelp() {
  openDialog({
    cls: "modal help",
    html: `<h2>Keyboard shortcuts</h2>
      ${SHORTCUTS.map(([g, rows]) => `<h3 class="mt">${g}</h3><table class="table"><tbody>${rows.map(([k, d]) =>
        `<tr><td style="white-space:nowrap;width:1%">${k.split("  or  ").map((p) => p.split(" / ").map((x) => x.trim().split(" ").map((y) => `<kbd>${esc(y)}</kbd>`).join(" ")).join(" / ")).join(" <span class='muted'>or</span> ")}</td><td>${esc(d)}</td></tr>`).join("")}</tbody></table>`).join("")}
      <div class="btns"><button class="btn btn-primary btn-md" autofocus>Close</button></div>`,
  });
}
