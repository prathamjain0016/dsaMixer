// dsaMixer board UI. Plain JS, talks to the FastAPI backend under /api.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const fmtDay = (s, opts = { weekday: "long", day: "numeric", month: "short" }) => new Date(s + "T00:00:00").toLocaleDateString(undefined, opts);
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`);
const TODAY = iso(new Date());

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).detail || res.statusText;
    toast(msg);
    throw new Error(msg);
  }
  return res.json();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

const state = { day: TODAY, board: null, sprint: "current", questions: null };

// ---------- tabs ----------
const loaders = { board: loadBoard, sprint: loadSprint, stats: loadStats, contests: loadContests, questions: loadQuestions, ai: () => { loadModules(); loadWeek(); }, settings: loadSettings };
function showTab(name) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  try { localStorage.setItem("tab", name); } catch {}
  loaders[name]();
}
$("#tabs").addEventListener("click", (e) => e.target.dataset.tab && showTab(e.target.dataset.tab));

// ---------- board ----------
const KIND_LABEL = { dsa: "DSA", review: "Review", ai: "AI", contest: "Contest", upsolve: "Upsolve", retro: "Retro", custom: "Task" };
const LOGGABLE = ["dsa", "review", "upsolve"];

async function loadBoard() {
  state.board = await api(`/day/${state.day}`);
  renderBoard();
}

function renderBoard() {
  const b = state.board;
  $("#dayTitle").textContent = fmtDay(b.date) + (b.date === TODAY ? " · Today" : "");
  $("#daySub").textContent = `Sprint ${b.sprint}` + (b.is_buffer ? " · buffer day (catch-up, contest, retro)" : "");

  const dsa = b.tickets.filter((t) => LOGGABLE.includes(t.kind) && t.status !== "skipped");
  const ai = b.tickets.filter((t) => t.kind === "ai" && t.status !== "skipped");
  const planned = dsa.reduce((s, t) => s + t.est_minutes, 0);
  const pct = b.dsa_budget ? Math.min(100, (planned / b.dsa_budget) * 100) : planned ? 100 : 0;
  const sum = (ts) => ts.reduce((s, t) => s + t.est_minutes, 0);
  $("#budgetBar").innerHTML = `
    <span>DSA planned ${hm(planned)} / budget ${hm(b.dsa_budget)}<span class="meter"><i class="${planned > b.dsa_budget ? "over" : ""}" style="width:${pct}%"></i></span></span>
    <span>AI ${hm(sum(ai))}</span>
    <span>Done ${b.tickets.filter((t) => t.status === "done").length}/${b.tickets.length}</span>`;

  const closed = b.day && b.day.closed_at;
  const banner = $("#dayBanner");
  if (!b.tickets.length && b.date > TODAY) {
    banner.innerHTML = `<div class="banner warn">This day isn't planned yet. Close ${b.date === addDays(TODAY, 1) ? "today" : "the day before"} to generate it.</div>`;
  } else if (closed) {
    banner.innerHTML = `<div class="banner ok"><span>Day closed. Tomorrow's plan is ready.</span><button class="ghost" id="goTomorrow">See tomorrow →</button></div>`;
    $("#goTomorrow").onclick = () => { state.day = addDays(b.date, 1); loadBoard(); };
  } else {
    banner.innerHTML = "";
  }
  $("#closeDayBtn").textContent = closed ? "Update day log" : "Close day";

  for (const col of $$(".col")) {
    const items = b.tickets.filter((t) => t.status === col.dataset.status);
    $(".count", col).textContent = items.length;
    $(".cards", col).innerHTML = items.map(cardHtml).join("");
  }
  $$(".card").forEach(bindCard);
}

function cardHtml(t) {
  const conf = t.confidence ? `<span class="conf" title="Confidence">${"●".repeat(t.confidence)}${"○".repeat(5 - t.confidence)}</span>` : "";
  const result = t.result ? `<span class="chip">${esc(t.result)}</span>` : "";
  const spent = t.minutes_spent != null ? `${hm(t.minutes_spent)} spent` : `~${hm(t.est_minutes)}`;
  return `<div class="card k-${t.kind} ${t.status}" draggable="true" data-id="${t.id}">
    <div class="row">
      <span class="chip kind">${KIND_LABEL[t.kind] || t.kind}</span>
      ${t.difficulty ? `<span class="diff ${t.difficulty}">${t.difficulty}</span>` : ""}
      ${t.carried ? `<span class="chip carried" title="Rolled over ${t.carried}×">↻ ${t.carried}</span>` : ""}
      ${t.url ? `<a class="link" href="${esc(t.url)}" target="_blank" rel="noopener" title="Find on LeetCode">LeetCode ↗</a>` : ""}
    </div>
    <div class="title">${esc(t.title)}</div>
    <div class="meta">${t.detail ? esc(t.detail) + " · " : t.pattern ? esc(t.pattern) + " · " : ""}${spent} ${conf} ${result}</div>
    ${t.note ? `<div class="meta">“${esc(t.note)}”</div>` : ""}
  </div>`;
}

function bindCard(el) {
  el.addEventListener("dragstart", (e) => { el.classList.add("dragging"); e.dataTransfer.setData("text/plain", el.dataset.id); });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  el.addEventListener("click", (e) => { if (e.target.closest("a")) return; openTicket(+el.dataset.id); });
}

for (const col of $$(".col")) {
  col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drag-over"); });
  col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    col.classList.remove("drag-over");
    const id = +e.dataTransfer.getData("text/plain");
    const t = state.board.tickets.find((x) => x.id === id);
    if (!t || t.status === col.dataset.status) return;
    if (col.dataset.status === "done" && (LOGGABLE.includes(t.kind) || t.kind === "ai")) return openTicket(id, "done");
    if (col.dataset.status === "done" && t.kind === "contest") { await moveTo(t, "done"); return logContestFrom(t); }
    await moveTo(t, col.dataset.status);
  });
}

async function moveTo(t, status) {
  await api(`/tickets/${t.id}`, { method: "PATCH", body: { status } });
  await loadBoard();
}

function openModal(html, onSubmit) {
  const dlg = $("#modal"), form = $("#modalForm");
  form.innerHTML = html;
  form.onsubmit = async (e) => {
    const btn = e.submitter;
    if (!btn || btn.value === "cancel") return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (await onSubmit(btn.value, data) !== false) dlg.close();
  };
  dlg.showModal();
}

function seg(name, options, current) {
  return `<div class="seg">${options.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${String(current) === String(v) ? "checked" : ""}>${l}</label>`).join("")}</div>`;
}

function openTicket(id, forceStatus) {
  const t = state.board.tickets.find((x) => x.id === id);
  const loggable = LOGGABLE.includes(t.kind);
  const isAi = t.kind === "ai";
  const status = forceStatus || t.status;
  openModal(`
    <h2>${esc(t.title)}</h2>
    <div class="muted small">${KIND_LABEL[t.kind]}${t.difficulty ? " · " + t.difficulty : ""}${t.pattern ? " · " + esc(t.pattern) : ""}${t.detail ? " · " + esc(t.detail) : ""}</div>
    ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Open on LeetCode ↗</a>` : ""}
    <label class="field">Status ${seg("status", [["todo", "To do"], ["doing", "In progress"], ["done", "Done"], ["skipped", "Skip"]], status)}</label>
    ${loggable ? `<label class="field">Result ${seg("result", [["solved", "Solved alone"], ["hints", "Needed hints"], ["failed", "Couldn't solve"]], t.result || "solved")}</label>
      <label class="field">Confidence (could you redo it cold?) ${seg("confidence", [1, 2, 3, 4, 5].map((n) => [n, n]), t.confidence || 3)}</label>` : ""}
    <label class="field">Minutes spent<input type="number" name="minutes_spent" min="0" value="${t.minutes_spent ?? t.est_minutes}"></label>
    ${loggable || isAi ? `<label class="field">${isAi ? "What you covered" : "Pattern / key insight"}<input name="note" value="${esc(t.note || "")}" placeholder="${isAi ? "e.g. backprop derivation, HW Q3" : "e.g. shrink window when count > k"}"></label>` : ""}
    ${loggable ? `<label class="field">Submission link<input name="link" value="${esc(t.link || "")}" placeholder="https://leetcode.com/submissions/…"></label>` : ""}
    <div class="btns">
      <button value="delete" class="ghost danger" formnovalidate>Delete</button>
      <button value="cancel" class="ghost" formnovalidate>Cancel</button>
      <button value="save" class="primary">Save</button>
    </div>`,
    async (action, data) => {
      if (action === "delete") {
        if (!confirm("Delete this card?")) return false;
        await api(`/tickets/${id}`, { method: "DELETE" });
      } else {
        const body = { status: data.status, minutes_spent: data.minutes_spent ? +data.minutes_spent : null };
        if ("note" in data) body.note = data.note || null;
        if ("link" in data) body.link = data.link || null;
        if (loggable) { body.result = data.result; body.confidence = +data.confidence; }
        await api(`/tickets/${id}`, { method: "PATCH", body });
        if (data.status === "done" && t.kind === "contest") logContestFrom(t);
      }
      loadBoard();
    });
}

function logContestFrom(t) {
  showTab("contests");
  const f = $("#contestForm");
  f.date.value = t.date;
  f.kind.value = t.title.includes("Biweekly") ? "biweekly" : t.title.includes("LIVE") ? "weekly" : "virtual";
  f.name.focus();
  toast("Log the contest result here");
}

$("#prevDay").onclick = () => { state.day = addDays(state.day, -1); loadBoard(); };
$("#nextDay").onclick = () => { state.day = addDays(state.day, 1); loadBoard(); };
$("#todayBtn").onclick = () => { state.day = TODAY; loadBoard(); };
$("#pullBtn").onclick = async () => { state.board = await api(`/day/${state.day}/pull`, { method: "POST" }); renderBoard(); toast("Pulled the next question"); };

$("#addCardBtn").onclick = () => openModal(`
  <h2>New card · ${fmtDay(state.day)}</h2>
  <label class="field">Title<input name="title" required autofocus></label>
  <label class="field">Type<select name="kind"><option value="custom">Task</option><option value="ai">AI</option><option value="dsa">DSA</option><option value="contest">Contest</option></select></label>
  <label class="field">Estimate (minutes)<input type="number" name="est_minutes" value="30" min="5"></label>
  <div class="btns"><button value="cancel" class="ghost" formnovalidate>Cancel</button><button value="save" class="primary">Add</button></div>`,
  async (_, d) => { state.board = await api("/tickets", { method: "POST", body: { date: state.day, title: d.title, kind: d.kind, est_minutes: +d.est_minutes } }); renderBoard(); });

$("#closeDayBtn").onclick = () => {
  const b = state.board;
  const open = b.tickets.filter((t) => ["todo", "doing"].includes(t.status));
  const done = b.tickets.filter((t) => t.status === "done");
  const aiNotes = b.tickets.filter((t) => t.kind === "ai" && t.note).map((t) => t.note).join("; ");
  const prev = b.day || {};
  openModal(`
    <h2>End of day · ${fmtDay(b.date)}</h2>
    <div>${done.length} done · <b>${open.length} open</b>${open.length ? " → these roll into tomorrow" : ""}</div>
    ${open.length ? `<div class="muted small">${open.map((t) => esc(t.title)).join("<br>")}</div>` : ""}
    <label class="field">Energy today ${seg("energy", [1, 2, 3, 4, 5].map((n) => [n, n]), prev.energy || 3)}</label>
    <label class="field">AI topics covered<input name="ai_topics" value="${esc(prev.ai_topics || aiNotes)}"></label>
    <label class="field">Notes / blockers<textarea name="notes" rows="3">${esc(prev.notes || "")}</textarea></label>
    <div class="btns"><button value="cancel" class="ghost" formnovalidate>Cancel</button><button value="save" class="primary">Close day & plan tomorrow</button></div>`,
    async (_, d) => {
      state.board = await api(`/day/${b.date}/close`, { method: "POST", body: { energy: +d.energy, ai_topics: d.ai_topics, notes: d.notes } });
      state.day = state.board.date;
      renderBoard();
      toast("Tomorrow is planned");
    });
};

// ---------- sprint ----------
async function loadSprint() {
  const s = await api(`/sprint/${state.sprint}`);
  state.sprintData = s;
  state.sprint = s.id;
  $("#sprintTitle").textContent = `Sprint ${s.id}` + (s.id === s.current ? " · current" : "");
  $("#sprintSub").textContent = `${fmtDay(s.start_date, { day: "numeric", month: "short" })} – ${fmtDay(s.end_date, { day: "numeric", month: "short" })} · Mon–Sat work, Sun buffer`;
  const rate = s.planned ? Math.round((s.done / s.planned) * 100) : 0;
  $("#sprintKpis").innerHTML = [
    kpi("Cards done", `${s.done}/${s.planned}`, `${rate}% completion`),
    kpi("New questions solved", s.questions_done),
    kpi("Cards carried in", s.carried_in, "rolled over from an earlier day"),
  ].join("");
  $("#sprintDays").innerHTML = s.days.map((d) => `
    <div class="sday ${d.date === TODAY ? "today" : ""} ${new Date(d.date + "T00:00:00").getDay() === 0 ? "buffer" : ""}" data-date="${d.date}">
      <div class="dname">${fmtDay(d.date, { weekday: "short", day: "numeric" })}</div>
      <div class="muted small">${d.total ? `${d.done}/${d.total} done` : "not planned yet"}</div>
      <div class="mini">${d.tickets.slice(0, 8).map((t) => `<span class="k-${t.kind} ${t.status === "done" ? "done" : ""}">${esc(t.title)}</span>`).join("")}${d.tickets.length > 8 ? `<span>+${d.tickets.length - 8} more</span>` : ""}</div>
    </div>`).join("");
  $$(".sday").forEach((el) => (el.onclick = () => { state.day = el.dataset.date; showTab("board"); }));
  $("#sprintGoal").value = s.goal || "";
  $("#sprintRetro").value = s.retro || "";
}
$("#prevSprint").onclick = () => { if (state.sprint > 1) { state.sprint--; loadSprint(); } };
$("#nextSprint").onclick = () => { state.sprint++; loadSprint().catch(() => { state.sprint--; }); };
$("#saveSprint").onclick = async () => {
  await api(`/sprint/${state.sprint}`, { method: "PATCH", body: { goal: $("#sprintGoal").value, retro: $("#sprintRetro").value } });
  toast("Sprint saved");
};

// ---------- stats ----------
const kpi = (label, value, sub = "") => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

async function loadStats() {
  const s = await api("/stats");
  const k = s.knight;
  $("#statKpis").innerHTML = [
    kpi("Questions solved", `${s.done}<span class="muted small"> / ${s.total}</span>`, `${s.mastered} mastered`),
    kpi("Streak", `${s.streak}d`, "days with at least one card done"),
    kpi("Reviews due", s.reviews_due, "spaced repetition queue"),
    kpi("Projected finish", s.projected_finish ? fmtDay(s.projected_finish, { day: "numeric", month: "short", year: "numeric" }) : "—", s.projected_finish_basis),
    kpi("AI this week", `${s.ai_hours_week}h`, `target ${s.ai_weekly_target_hours}h`),
    kpi("Contest rating", k.rating ?? "—", `target ${k.target_rating}`),
  ].join("");

  $("#dailyLegend").innerHTML = `<span class="key"><i class="sw s1"></i>DSA</span><span class="key"><i class="sw s2"></i>AI</span>`;
  barChart($("#dailyChart"), s.daily);

  const order = ["Easy", "Medium", "Hard"];
  $("#diffBars").innerHTML = s.by_difficulty.sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty))
    .map((r) => hbar(`<span class="diff ${r.difficulty}">${r.difficulty}</span>`, r.done || 0, r.total)).join("");
  $("#sectionBars").innerHTML = s.by_section.map((r) => hbar(esc(r.section), r.done || 0, r.total)).join("");

  const q = s.quality;
  $("#quality").innerHTML = q.n
    ? `${hbar("Solved alone", q.solved || 0, q.n)}${hbar("Needed hints", q.hints || 0, q.n)}${hbar("Couldn't solve", q.failed || 0, q.n)}<div class="muted small">Avg confidence ${q.avg_conf ?? "—"} / 5 across ${q.n} logged attempts</div>`
    : `<div class="muted small">Log a few questions to see this.</div>`;
  $("#weak").innerHTML = s.weak_patterns.length
    ? s.weak_patterns.map((w) => `<div class="hbar"><span>${esc(w.subtopic)}</span><div class="track"><div class="fill" style="width:${(w.avg_conf / 5) * 100}%"></div></div><span class="num">${w.avg_conf}/5</span></div>`).join("")
    : `<div class="muted small">Needs at least 2 logged questions in a pattern.</div>`;
}

function hbar(label, n, total) {
  const pct = total ? (n / total) * 100 : 0;
  return `<div class="hbar"><span>${label}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="num">${n}/${total}</span></div>`;
}

// Grouped bars (DSA vs AI) per day with a hover tooltip.
function barChart(el, days) {
  if (!days.some((d) => d.dsa || d.ai)) { el.innerHTML = `<div class="empty">No completed cards in the last 28 days yet.</div>`; return; }
  const W = 1200, H = 220, L = 44, B = 22, T = 8;
  const max = Math.max(60, ...days.map((d) => Math.max(d.dsa, d.ai)));
  const top = Math.ceil(max / 60) * 60;
  const slot = (W - L) / days.length, bw = Math.max(3, (slot - 6) / 2);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let svg = "";
  for (let v = 0; v <= top; v += top / 4) svg += `<line class="gridline" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${hm(v)}</text>`;
  days.forEach((d, i) => {
    const x = L + i * slot + 2;
    const bar = (v, dx, cls) => v ? `<path d="${roundTop(x + dx, y(v), bw, y(0) - y(v))}" fill="var(--${cls})"/>` : "";
    svg += bar(d.dsa, 0, "series-1") + bar(d.ai, bw + 2, "series-2");
    if (i % 7 === 0 || i === days.length - 1) svg += `<text x="${x + bw}" y="${H - 4}" text-anchor="middle">${fmtDay(d.date, { day: "numeric", month: "short" })}</text>`;
    svg += `<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" data-i="${i}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes per day, DSA and AI">${svg}</svg>`;
  bindTips(el, (i) => { const d = days[i]; return `<div>${fmtDay(d.date)}</div><div><i class="sw s1"></i> DSA <b>${hm(d.dsa)}</b> · ${d.questions} new Qs</div><div><i class="sw s2"></i> AI <b>${hm(d.ai)}</b></div>`; });
}

function roundTop(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function bindTips(el, html) {
  const tip = $("#tooltip");
  $$(".hit", el).forEach((h) => {
    h.addEventListener("mousemove", (e) => {
      tip.innerHTML = html(+h.dataset.i);
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = e.clientY + 14 + "px";
    });
    h.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}

// ---------- contests ----------
async function loadContests() {
  const [list, s] = await Promise.all([api("/contests"), api("/stats")]);
  const k = s.knight;
  const left = Math.max(0, Math.ceil((new Date(k.deadline) - new Date()) / 864e5));
  $("#knightKpis").innerHTML = [
    kpi("Current rating", k.rating ?? "unrated", "LeetCode starts you at 1500 after your first rated contest"),
    kpi("Knight target", k.target_rating, k.rating ? `${Math.max(0, k.target_rating - k.rating)} to go` : ""),
    kpi("Contests done", k.contests, "incl. virtual"),
    kpi("Solved 3+", k.q3_rate != null ? Math.round(k.q3_rate * 100) + "%" : "—", "share of contests with Q3 solved — the Knight habit"),
    kpi("Days to deadline", left, fmtDay(k.deadline, { day: "numeric", month: "short", year: "numeric" })),
  ].join("");
  lineChart($("#ratingChart"), list.filter((c) => c.rating).reverse(), k.target_rating);
  const f = $("#contestForm");
  if (!f.date.value) f.date.value = TODAY;
  $("#contestTable").innerHTML = list.length
    ? `<tr><th>Date</th><th>Contest</th><th>Type</th><th>Q1–Q4</th><th>Rank</th><th>Rating</th><th>Notes</th><th></th></tr>` +
      list.map((c) => `<tr><td>${c.date}</td><td>${esc(c.name)}</td><td>${c.kind}</td><td>${c.q_solved.map((x) => (x ? "✓" : "·")).join(" ")}</td><td>${c.rank ?? ""}</td><td>${c.rating ?? ""}</td><td>${esc(c.notes || "")}</td><td><button class="ghost" data-del="${c.id}">✕</button></td></tr>`).join("")
    : `<tr><td class="empty">No contests yet. Your first one is on the Sunday board.</td></tr>`;
  $$("[data-del]", $("#contestTable")).forEach((b) => (b.onclick = async () => { if (confirm("Delete contest?")) { await api(`/contests/${b.dataset.del}`, { method: "DELETE" }); loadContests(); } }));
}

$("#contestForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  await api("/contests", { method: "POST", body: {
    date: f.date.value, name: f.name.value, kind: f.kind.value,
    q_solved: [0, 1, 2, 3].map((i) => f["q" + i].checked),
    rank: f.rank.value ? +f.rank.value : null, rating: f.rating.value ? +f.rating.value : null, notes: f.notes.value || null,
  } });
  f.reset();
  toast("Contest logged — upsolve card added for tomorrow");
  loadContests();
};

function lineChart(el, pts, target) {
  if (!pts.length) { el.innerHTML = `<div class="empty">Log a rated (live) contest to start the rating line.</div>`; return; }
  const W = 1200, H = 260, L = 44, B = 22, T = 10, R = 10;
  const vals = pts.map((p) => p.rating).concat(target);
  const lo = Math.floor((Math.min(...vals) - 50) / 100) * 100, hi = Math.ceil((Math.max(...vals) + 50) / 100) * 100;
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let svg = "";
  for (let v = lo; v <= hi; v += (hi - lo) / 4) svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - R}" y="${y(target) - 6}" text-anchor="end">Knight ${target}</text>`;
  svg += `<polyline fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" points="${pts.map((p, i) => `${x(i)},${y(p.rating)}`).join(" ")}"/>`;
  pts.forEach((p, i) => (svg += `<circle cx="${x(i)}" cy="${y(p.rating)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>`));
  const slot = pts.length > 1 ? (W - L - R) / (pts.length - 1) : W - L - R;
  pts.forEach((_, i) => (svg += `<rect class="hit" x="${x(i) - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" data-i="${i}"/>`));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Contest rating over time">${svg}</svg>`;
  bindTips(el, (i) => { const p = pts[i]; return `<div>${esc(p.name)} · ${p.date}</div><div>Rating <b>${p.rating}</b> · solved ${p.solved}/4${p.rank ? ` · rank ${p.rank}` : ""}</div>`; });
}

// ---------- questions ----------
async function loadQuestions() {
  if (!state.questions) {
    state.questions = await api("/questions");
    const secs = [...new Set(state.questions.map((q) => q.section))];
    $("#qSection").innerHTML += secs.map((s) => `<option>${esc(s)}</option>`).join("");
  } else {
    state.questions = await api("/questions");
  }
  renderQuestions();
}
function renderQuestions() {
  const term = $("#qSearch").value.toLowerCase(), sec = $("#qSection").value, st = $("#qStatus").value;
  const list = state.questions.filter((q) => (!sec || q.section === sec) && (!st || q.status === st) &&
    (!term || (q.title + " " + q.pattern + " " + q.subtopic).toLowerCase().includes(term)));
  $("#qTable").innerHTML = `<tr><th>#</th><th>Question</th><th>Diff</th><th>Pattern</th><th>Status</th><th>Attempts</th><th>Conf</th><th>Next review</th></tr>` +
    list.map((q) => `<tr><td>${q.num}</td><td><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.title)}</a></td><td><span class="diff ${q.difficulty}">${q.difficulty}</span></td>
      <td class="muted">${esc(q.subtopic)}</td><td><span class="status-pill ${q.status}">${q.status}</span></td><td>${q.attempts || ""}</td><td>${q.last_confidence ?? ""}</td><td>${q.next_review ?? ""}</td></tr>`).join("");
}
["#qSearch", "#qSection", "#qStatus"].forEach((s) => $(s).addEventListener("input", renderQuestions));

// ---------- AI modules ----------
async function loadModules(list) {
  list = Array.isArray(list) ? list : await api("/ai-modules");
  $("#modules").innerHTML = list.length
    ? list.map((m) => `<div class="module"><span class="muted">${m.position}.</span><span class="t">${esc(m.title)}</span>
        <select data-mod="${m.id}">${["upcoming", "in_progress", "done"].map((s) => `<option value="${s}" ${m.status === s ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}</select>
        <button class="ghost" data-delmod="${m.id}">✕</button></div>`).join("")
    : `<div class="muted small">No syllabus yet — paste it on the right whenever you have it.</div>`;
  $$("[data-mod]").forEach((s) => (s.onchange = async () => loadModules(await api(`/ai-modules/${s.dataset.mod}`, { method: "PATCH", body: { status: s.value } }))));
  $$("[data-delmod]").forEach((b) => (b.onclick = async () => loadModules(await api(`/ai-modules/${b.dataset.delmod}`, { method: "DELETE" }))));
}
$("#importModules").onclick = async () => {
  const text = $("#moduleImport").value.trim();
  if (!text) return;
  loadModules(await api("/ai-modules/import", { method: "POST", body: { text } }));
  $("#moduleImport").value = "";
  toast("Syllabus imported");
};

// ---------- weekly AI plan ----------
async function loadWeek() {
  const w = await api("/ai-week");
  state.week = w;
  const cap = Object.values(w.capacity).reduce((a, b) => a + b, 0);
  $("#weekInfo").textContent = w.days.length
    ? `${fmtDay(w.days[0], { weekday: "short", day: "numeric", month: "short" })} – ${fmtDay(w.days.at(-1), { weekday: "short", day: "numeric", month: "short" })} · ${hm(cap)} of AI time · ${w.model} via ${w.provider === "openrouter" ? "OpenRouter" : "Anthropic"}`
    : "No weekdays left this week";
  $("#weekKeyWarn").innerHTML = w.key_configured ? "" :
    `<div class="banner warn"><span>No API key found. Add <code>OPENROUTER_API_KEY=…</code> (or <code>ANTHROPIC_API_KEY=…</code>) to <code>.env</code> and restart the app.</span></div>`;
  if (w.plan && !state.weekDraft) {
    $("#weekGoals").value = w.plan.goals;
    $("#weekPreview").innerHTML = `<div class="banner ok"><span>This week's plan is on your boards (${esc(w.plan.created_at)}). Break it down again to replace the cards you haven't started.</span></div>`;
  }
}

$("#breakdownBtn").onclick = async () => {
  const goals = $("#weekGoals").value.trim();
  if (!goals) return toast("Describe your goals first");
  const btn = $("#breakdownBtn");
  btn.disabled = true; btn.textContent = "Thinking…";
  try {
    state.weekDraft = { goals, ...(await api("/ai-week/preview", { method: "POST", body: { goals } })) };
    renderWeekPreview();
  } finally {
    btn.disabled = false; btn.textContent = "Break down with AI";
  }
};

function renderWeekPreview() {
  const d = state.weekDraft;
  const dayOpt = (sel) => d.days.map((x) => `<option value="${x}" ${x === sel ? "selected" : ""}>${fmtDay(x, { weekday: "short", day: "numeric" })}</option>`).join("");
  const totals = d.days.map((x) => {
    const used = d.tasks.filter((t) => t.date === x).reduce((s, t) => s + (+t.minutes || 0), 0);
    return `<span class="chip ${used > d.capacity[x] ? "carried" : ""}">${fmtDay(x, { weekday: "short" })} ${hm(used)} / ${hm(d.capacity[x])}</span>`;
  }).join(" ");
  $("#weekPreview").innerHTML = `
    <p class="mt">${esc(d.summary)}</p>
    <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${totals}</div>
    <table class="table"><tr><th>Day</th><th>Goal</th><th>Task</th><th>Min</th><th></th></tr>
    ${d.tasks.map((t, i) => `<tr data-i="${i}">
      <td><select data-f="date">${dayOpt(t.date)}</select></td>
      <td class="muted">${esc(t.goal)}</td>
      <td><input data-f="title" value="${esc(t.title)}" style="width:100%"></td>
      <td><input data-f="minutes" type="number" min="5" step="5" value="${t.minutes}" style="width:80px"></td>
      <td><button class="ghost" data-del="${i}" title="Remove">✕</button></td></tr>`).join("")}
    </table>
    <div class="row-buttons"><button class="primary" id="applyWeek">Add ${d.tasks.length} tasks to boards</button><button class="ghost" id="discardWeek">Discard</button></div>`;
  $$("#weekPreview tr[data-i] [data-f]").forEach((el) => (el.onchange = () => {
    const t = d.tasks[+el.closest("tr").dataset.i];
    t[el.dataset.f] = el.dataset.f === "minutes" ? +el.value : el.value;
    if (el.dataset.f !== "title") renderWeekPreview();
  }));
  $$("#weekPreview [data-del]").forEach((b) => (b.onclick = () => { d.tasks.splice(+b.dataset.del, 1); renderWeekPreview(); }));
  $("#discardWeek").onclick = () => { state.weekDraft = null; $("#weekPreview").innerHTML = ""; };
  $("#applyWeek").onclick = async () => {
    const r = await api("/ai-week/apply", { method: "POST", body: { goals: d.goals, summary: d.summary, tasks: d.tasks } });
    state.weekDraft = null;
    toast(`Added ${r.added} AI tasks across the week`);
    loadWeek();
  };
}

// ---------- settings ----------
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
async function loadSettings() {
  const c = await api("/settings");
  state.cfg = c;
  $("#budgetInputs").innerHTML = DAYS.map((d) => `<label>${d}<input type="number" min="0" step="15" data-budget="${d}" value="${c.dsa_minutes[d]}"></label>`).join("");
  $("#estInputs").innerHTML = ["Easy", "Medium", "Hard"].map((d) => `<label>${d}<input type="number" min="5" step="5" data-est="${d}" value="${c.est_minutes[d]}"></label>`).join("") +
    `<label>Review<input type="number" min="5" step="5" id="reviewMin" value="${c.review_minutes}"></label><label>Max reviews/day<input type="number" min="0" id="maxReviews" value="${c.max_reviews_per_day}"></label>`;
  $("#weeklyLive").checked = c.contests.weekly_live;
  $("#biweeklyAnchor").value = c.contests.biweekly_anchor;
  $("#rawConfig").value = JSON.stringify(c, null, 2);
}
$("#saveSettings").onclick = async () => {
  const c = state.cfg;
  $$("[data-budget]").forEach((i) => (c.dsa_minutes[i.dataset.budget] = +i.value));
  $$("[data-est]").forEach((i) => (c.est_minutes[i.dataset.est] = +i.value));
  c.review_minutes = +$("#reviewMin").value;
  c.max_reviews_per_day = +$("#maxReviews").value;
  c.contests.weekly_live = $("#weeklyLive").checked;
  c.contests.biweekly_anchor = $("#biweeklyAnchor").value;
  await api("/settings", { method: "PUT", body: c });
  toast("Saved — applies from the next planned day (or hit Replan today)");
  loadSettings();
};
$("#saveRaw").onclick = async () => {
  let c;
  try { c = JSON.parse($("#rawConfig").value); } catch (e) { return toast("Invalid JSON: " + e.message); }
  await api("/settings", { method: "PUT", body: c });
  toast("Config saved");
  loadSettings();
};
$("#replanBtn").onclick = async () => {
  await api(`/day/${TODAY}/replan`, { method: "POST" });
  toast("Today replanned");
};

// ---------- boot ----------
let startTab = location.hash.slice(1) || "board";
try { if (!location.hash) startTab = localStorage.getItem("tab") || "board"; } catch {}
showTab(loaders[startTab] ? startTab : "board");
