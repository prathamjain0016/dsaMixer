// Hand-rolled SVG charts. Series colours live in CSS tokens; chart text uses ink tokens (see components.css).
// Every chart sizes itself to its container (1 SVG unit = 1px) and redraws on resize.
import { esc, fmtDay, hm, debounce } from "./util.js";
import { bindTips } from "./ui.js";
import { EmptyState } from "./components/index.js";

function mount(el, draw) {
  const run = () => { el._w = el.clientWidth; draw(Math.max(el.clientWidth, 240)); };
  run();
  if (!el._ro && typeof ResizeObserver !== "undefined") {
    el._ro = new ResizeObserver(debounce(() => { if (Math.abs(el.clientWidth - (el._w || 0)) > 2) run(); }, 100));
    el._ro.observe(el);
  }
}

export const legend = (items) => items.map(([cls, label]) => `<span class="key"><i class="sw ${cls}"></i>${label}</span>`).join("");

function roundTop(x, y, w, h) {
  const r = Math.min(3, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** GitHub-style activity grid: columns are whole Mon-Sun weeks, cells stretch to fill the width. days = [{date, done, minutes}]. */
export function heatmap(el, all, { weeks = 26, mini = false } = {}) {
  if (!all.length) { el.innerHTML = EmptyState({ icon: "calendar", title: "No activity yet", compact: true }); return; }
  const lastDow = (new Date(all[all.length - 1].date + "T00:00:00").getDay() + 6) % 7;
  const days = all.slice(-((weeks - 1) * 7 + lastDow + 1)); // start on a Monday
  mount(el, (W) => {
    const gap = mini ? 3 : 4, LW = mini ? 16 : 30, TH = 18;
    const offset = (new Date(days[0].date + "T00:00:00").getDay() + 6) % 7;
    const cols = Math.ceil((offset + days.length) / 7);
    const cw = Math.max(8, (W - LW + gap) / cols - gap), ch = Math.min(cw, mini ? 14 : 22);
    const w = W, h = TH + 7 * (ch + gap) - gap;
    const max = Math.max(1, ...days.map((d) => d.done));
    const level = (n) => (n ? Math.max(1, Math.ceil((n / max) * 5)) : 0);
    const X = (col) => LW + col * (cw + gap), Y = (row) => TH + row * (ch + gap);
    let svg = "", lastMonth = -1, lastLabelCol = -9;
    (mini ? ["M", "W", "F"] : ["Mon", "Wed", "Fri"]).forEach((l, i) => (svg += `<text class="hm-lbl" x="0" y="${Y(i * 2) + ch / 2}" dominant-baseline="central">${l}</text>`));
    days.forEach((d, i) => {
      const col = Math.floor((offset + i) / 7), row = (offset + i) % 7;
      const m = new Date(d.date + "T00:00:00").getMonth();
      if (m !== lastMonth) {
        if (col - lastLabelCol >= (mini ? 3 : 3) && X(col) + 24 <= W) { svg += `<text class="hm-lbl" x="${X(col)}" y="${TH - 6}">${fmtDay(d.date, { month: "short" })}</text>`; lastLabelCol = col; }
        lastMonth = m;
      }
      svg += `<rect class="hm${level(d.done) || ""} hm-cell" data-i="${i}" x="${X(col)}" y="${Y(row)}" width="${cw}" height="${ch}" rx="${mini ? 2 : 3}"/>`;
    });
    const total = days.reduce((s, d) => s + d.done, 0);
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Activity over the last ${weeks} weeks: ${total} cards done" style="display:block">${svg}</svg>` +
      `<div class="hm-legend"><span>Less</span>${[0, 1, 2, 3, 4, 5].map((l) => `<i style="background:var(--h${l})"></i>`).join("")}<span>More</span></div>`;
    bindTips(el, (i) => { const d = days[i]; return `<div><b>${fmtDay(d.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</b></div><div>${d.done} card${d.done === 1 ? "" : "s"} done${d.minutes ? " · " + hm(d.minutes) : ""}</div>`; });
  });
}

/** Tiny rating trend with a dashed target line. pts = [{rating, date, name}]. */
export function sparkline(el, pts, target) {
  if (!pts.length) { el.innerHTML = EmptyState({ icon: "trophy", title: "No rated contest yet", compact: true }); return; }
  mount(el, (W) => {
    const H = 56, P = 6;
    const vals = pts.map((p) => p.rating).concat(target);
    const lo = Math.min(...vals) - 30, hi = Math.max(...vals) + 30;
    const x = (i) => (pts.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (pts.length - 1));
    const y = (v) => P + (H - 2 * P) * (1 - (v - lo) / (hi - lo));
    let svg = `<line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    svg += `<polyline fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" points="${pts.map((p, i) => `${x(i)},${y(p.rating)}`).join(" ")}"/>`;
    pts.forEach((p, i) => (svg += `<circle cx="${x(i)}" cy="${y(p.rating)}" r="3.5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="1.5"/>`));
    const slot = pts.length > 1 ? (W - 2 * P) / (pts.length - 1) : W;
    pts.forEach((_, i) => (svg += `<rect class="hit" x="${x(i) - slot / 2}" y="0" width="${slot}" height="${H}" data-i="${i}"/>`));
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Rating trend, target ${target}">${svg}</svg>`;
    bindTips(el, (i) => `<div>${esc(pts[i].name)} · ${pts[i].date}</div><div>Rating <b>${pts[i].rating}</b> (target ${target})</div>`);
  });
}

/** Per-day grouped bars (DSA vs AI minutes), single y-axis. days = [{date, dsa, ai, questions}]. */
export function groupedBars(el, days) {
  if (!days.some((d) => d.dsa || d.ai)) { el.innerHTML = EmptyState({ icon: "stats", title: "No completed cards in the last 28 days", hint: "Finish a card and its minutes show up here." }); return; }
  mount(el, (W) => {
    const H = 220, L = 44, B = 22, T = 8;
    const max = Math.max(60, ...days.map((d) => Math.max(d.dsa, d.ai)));
    const top = Math.ceil(max / 60) * 60;
    const slot = (W - L) / days.length, bw = Math.max(2, (slot - 5) / 2);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    let svg = "";
    for (let v = 0; v <= top; v += top / 4) svg += `<line class="gridline" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${hm(v)}</text>`;
    days.forEach((d, i) => {
      const x = L + i * slot + 2;
      const bar = (v, dx, cls) => (v ? `<path d="${roundTop(x + dx, y(v), bw, y(0) - y(v))}" fill="var(--${cls})"/>` : "");
      svg += bar(d.dsa, 0, "series-1") + bar(d.ai, bw + 1, "series-2");
      if (i % 7 === 0 || i === days.length - 1) svg += `<text x="${x + bw}" y="${H - 4}" text-anchor="middle">${fmtDay(d.date, { day: "numeric", month: "short" })}</text>`;
      svg += `<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" data-i="${i}"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Minutes per day, DSA and AI">${svg}</svg>`;
    bindTips(el, (i) => { const d = days[i]; return `<div><b>${fmtDay(d.date)}</b></div><div><i class="sw s1"></i> DSA ${hm(d.dsa)} · ${d.questions} new Qs</div><div><i class="sw s2"></i> AI ${hm(d.ai)}</div>`; });
  });
}

/** Contest rating over time with a dashed target line. pts = contests with a rating, oldest first. */
export function ratingLine(el, pts, target) {
  if (!pts.length) { el.innerHTML = EmptyState({ icon: "trophy", title: "No rated contests yet", hint: "Log a rated (live) contest to start the rating line." }); return; }
  mount(el, (W) => {
    const H = 260, L = 44, B = 22, T = 10, R = 10;
    const vals = pts.map((p) => p.rating).concat(target);
    const lo = Math.floor((Math.min(...vals) - 50) / 100) * 100, hi = Math.ceil((Math.max(...vals) + 50) / 100) * 100;
    const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    let svg = "";
    for (let v = lo; v <= hi; v += (hi - lo) / 4) svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - R}" y="${y(target) - 6}" text-anchor="end">Knight ${target}</text>`;
    const line = pts.map((p, i) => `${x(i)},${y(p.rating)}`).join(" ");
    svg += `<defs><linearGradient id="rlFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--series-1)" stop-opacity=".18"/><stop offset="1" stop-color="var(--series-1)" stop-opacity="0"/></linearGradient></defs>`;
    if (pts.length > 1) svg += `<polygon fill="url(#rlFill)" points="${x(0)},${y(lo)} ${line} ${x(pts.length - 1)},${y(lo)}"/>`;
    svg += `<polyline fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" points="${line}"/>`;
    pts.forEach((p, i) => (svg += `<circle cx="${x(i)}" cy="${y(p.rating)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>`));
    const slot = pts.length > 1 ? (W - L - R) / (pts.length - 1) : W - L - R;
    pts.forEach((_, i) => (svg += `<rect class="hit" x="${x(i) - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" data-i="${i}"/>`));
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Contest rating over time">${svg}</svg>`;
    bindTips(el, (i) => { const p = pts[i]; return `<div>${esc(p.name)} · ${p.date}</div><div>Rating <b>${p.rating}</b> · solved ${p.solved}/4${p.rank ? ` · rank ${p.rank}` : ""}</div>`; });
  });
}
