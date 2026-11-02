// Global keyboard shortcuts. Views register their own handler with setViewKeys().
import { overlayOpen, openDialog } from "./ui.js";
import { esc } from "./util.js";

export const TABS = ["today", "week", "sprint", "stats", "contests", "questions", "ai", "settings"];

export const SHORTCUTS = [
  ["Everywhere", [["1 – 8", "Switch tab (Today, Week, Sprint, Stats, Contests, Questions, AI course, Settings)"], ["?", "Show this help"], ["Esc", "Close any dialog or drawer"]]],
  ["Today", [
    ["j / k  or  ↓ / ↑", "Select next / previous card"], ["h / l  or  ← / →", "Move selected card to previous / next column"],
    ["Enter", "Open the card (edit)"], ["x", "Mark selected card done (quick log)"], ["Space", "Start / pause timer (selected card, else Now card)"],
    ["n", "New card"], ["p", "Pull next question"], ["c", "Close day"], ["[  /  ]", "Previous / next day"], [".", "Jump to today"],
  ]],
  ["Week", [["[  /  ]", "Previous / next week"], [".", "Jump to this week"]]],
  ["Questions", [["/", "Focus the search box"]]],
];

let viewHandler = null;
export const setViewKeys = (fn) => { viewHandler = fn; };

const typing = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

export function initKeys(go) {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target) || overlayOpen()) return;
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
        `<tr><td style="white-space:nowrap">${k.split("  or  ").map((p) => p.split(" / ").map((x) => `<kbd>${esc(x.trim())}</kbd>`).join(" ")).join(" or ")}</td><td>${esc(d)}</td></tr>`).join("")}</tbody></table>`).join("")}
      <div class="btns"><button class="btn primary" autofocus>Close</button></div>`,
  });
}
