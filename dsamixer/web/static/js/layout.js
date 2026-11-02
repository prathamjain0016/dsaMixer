// Customizable widget grid (Today, Stats): reorder by dragging, hide/show, half/full width.
// The layout is a per-viewer UI pref in localStorage "dsm.layout.<page>" = {order, hidden, span}.
import { $, $$, esc, lsGetJson, lsSet } from "./util.js";
import { Widget, IconButton, Button, openMenu } from "./components/index.js";

const SIZE_LABEL = { 3: "¼ width", 4: "⅓ width", 6: "½ width", 8: "⅔ width", 12: "Full width" };
const DRAG_TYPE = "application/x-dsm-widget";

/**
 * defs: [{id, title, span, sizes?: [spans], fixed?: true (can't hide), actions?: html, cls?}]
 * paint(): called after every (re)render so the view fills the widget bodies (#wb-<id>).
 * controls: element (or () => element) that receives the Customize / Add widget / Reset / Done buttons.
 */
export function createDashboard({ page, root, defs, paint, controls }) {
  const key = `dsm.layout.${page}`;
  let editing = false;
  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));

  const load = () => {
    const s = lsGetJson(key, {}) || {};
    const order = (Array.isArray(s.order) ? s.order : []).filter((id) => byId[id]);
    defs.forEach((d) => { if (!order.includes(d.id)) order.push(d.id); });
    const hidden = (Array.isArray(s.hidden) ? s.hidden : []).filter((id) => byId[id] && !byId[id].fixed);
    return { order, hidden, span: s.span && typeof s.span === "object" ? s.span : {} };
  };
  let L = load();
  const save = () => lsSet(key, JSON.stringify(L));
  const spanOf = (d) => { const s = +L.span[d.id]; return (d.sizes || [d.span]).includes(s) ? s : d.span; };
  const visible = () => L.order.filter((id) => !L.hidden.includes(id)).map((id) => byId[id]);

  function editControls(d) {
    const sizes = d.sizes || [];
    return (sizes.length > 1 ? IconButton({ icon: "resize", label: `Size: ${SIZE_LABEL[spanOf(d)]}. Click to change`, size: "sm", attrs: { "data-size": d.id } }) : "") +
      (d.fixed ? "" : IconButton({ icon: "eyeOff", label: `Hide ${d.title}`, size: "sm", attrs: { "data-hide": d.id } }));
  }

  function render() {
    root.className = `dash${editing ? " editing" : ""}`;
    root.innerHTML = visible().map((d) => Widget({
      id: d.id, title: d.title, span: spanOf(d), cls: d.cls || "", actions: editing ? "" : (d.actions || ""), flush: d.flush,
      edit: editing ? editControls(d) : "",
    })).join("");
    paintControls();
    paint();
  }

  function paintControls() {
    const host = typeof controls === "function" ? controls() : controls;
    if (!host) return;
    const hiddenN = L.hidden.length;
    host.innerHTML = editing
      ? Button({ label: `Add widget${hiddenN ? ` (${hiddenN})` : ""}`, icon: "plus", size: "md", id: "dashAdd", attrs: hiddenN ? {} : { disabled: true } }) +
        Button({ label: "Reset layout", kind: "ghost", size: "md", id: "dashReset" }) +
        Button({ label: "Done", kind: "primary", size: "md", id: "dashDone", icon: "check" })
      : Button({ label: "Customize", icon: "layout", kind: "ghost", size: "md", id: "dashEdit", tip: "Rearrange, resize or hide widgets" });
    $("#dashEdit", host)?.addEventListener("click", () => setEditing(true));
    $("#dashDone", host)?.addEventListener("click", () => setEditing(false));
    $("#dashReset", host)?.addEventListener("click", () => { L = { order: defs.map((d) => d.id), hidden: [], span: {} }; save(); render(); });
    $("#dashAdd", host)?.addEventListener("click", (e) => openMenu(e.currentTarget, [
      { heading: "Hidden widgets" },
      ...L.hidden.map((id) => ({ label: esc(byId[id].title), icon: "eye", onSelect: () => { L.hidden = L.hidden.filter((x) => x !== id); save(); render(); } })),
    ]));
  }

  function setEditing(on) { editing = on; render(); }

  // Edit-mode controls inside widgets.
  root.addEventListener("click", (e) => {
    const h = e.target.closest("[data-hide]");
    if (h) { L.hidden.push(h.dataset.hide); save(); return render(); }
    const s = e.target.closest("[data-size]");
    if (s) {
      const d = byId[s.dataset.size], sizes = d.sizes, i = sizes.indexOf(spanOf(d));
      L.span[d.id] = sizes[(i + 1) % sizes.length];
      save(); render();
    }
  });

  // Reorder: drag a widget by its grip onto another widget (before/after by pointer position).
  let dragId = null;
  root.addEventListener("dragstart", (e) => {
    const g = e.target.closest?.(".w-grip");
    if (!g || !editing) return;
    dragId = g.closest(".widget").dataset.wid;
    e.dataTransfer.setData(DRAG_TYPE, dragId);
    e.dataTransfer.effectAllowed = "move";
    const w = g.closest(".widget");
    e.dataTransfer.setDragImage(w, 24, 16);
    requestAnimationFrame(() => w.classList.add("w-dragging"));
  });
  const clearMarks = () => $$(".drop-before, .drop-after", root).forEach((x) => x.classList.remove("drop-before", "drop-after"));
  root.addEventListener("dragover", (e) => {
    if (!dragId || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    const w = e.target.closest(".widget");
    if (!w || w.dataset.wid === dragId) return;
    e.preventDefault();
    const r = w.getBoundingClientRect();
    const after = r.width > r.height * 2.2 ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    clearMarks();
    w.classList.add(after ? "drop-after" : "drop-before");
  });
  root.addEventListener("drop", (e) => {
    if (!dragId || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    const w = e.target.closest(".widget");
    e.preventDefault();
    if (w && w.dataset.wid !== dragId) {
      const after = w.classList.contains("drop-after");
      L.order = L.order.filter((id) => id !== dragId);
      L.order.splice(L.order.indexOf(w.dataset.wid) + (after ? 1 : 0), 0, dragId);
      save();
    }
    dragId = null;
    render();
  });
  root.addEventListener("dragend", () => { if (dragId) { dragId = null; clearMarks(); $$(".w-dragging", root).forEach((x) => x.classList.remove("w-dragging")); } });

  return {
    render,
    paintControls,
    get editing() { return editing; },
    setEditing,
    isVisible: (id) => !L.hidden.includes(id),
  };
}
