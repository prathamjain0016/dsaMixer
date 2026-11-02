// One study timer at a time, persisted in localStorage so it survives reloads and day navigation.
// State: {ticketId, date, title, startedAt (ms, null while paused), accumulatedMs, baseMinutes}
// baseMinutes is the ticket's minutes_spent when the timer was created, so saving is base + elapsed.
import { lsGetJson, lsSet, clock } from "./util.js";
import { patchTicket } from "./api.js";

const KEY = "dsm.timer";
const listeners = new Set();

export const get = () => lsGetJson(KEY);
const put = (t) => { lsSet(KEY, t ? JSON.stringify(t) : "null"); emit(); };
const emit = () => listeners.forEach((fn) => fn(get()));
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const elapsedMs = (t = get()) => (t ? t.accumulatedMs + (t.startedAt ? Date.now() - t.startedAt : 0) : 0);
export const isRunning = (id) => { const t = get(); return !!t && !!t.startedAt && (id == null || t.ticketId === id); };
export const forTicket = (id) => { const t = get(); return t && t.ticketId === id ? t : null; };
export const minutesFor = (t = get()) => (t ? Math.ceil(elapsedMs(t) / 6e4) : 0);
export const clockText = (t = get()) => clock(elapsedMs(t));

/** Minutes to log for this ticket: what it had plus the timer's elapsed time (rounded up). */
export function totalMinutes(ticket) {
  const t = forTicket(ticket.id);
  return t ? t.baseMinutes + minutesFor(t) : null;
}

/** Start (or resume) a timer on a ticket. Another running/paused timer is saved to its ticket first. */
export async function start(ticket) {
  const cur = get();
  if (cur && cur.ticketId === ticket.id) {
    if (!cur.startedAt) put({ ...cur, startedAt: Date.now() });
    return;
  }
  if (cur) await saveAndClear(cur);
  put({ ticketId: ticket.id, date: ticket.date, title: ticket.title, startedAt: Date.now(), accumulatedMs: 0, baseMinutes: ticket.minutes_spent || 0 });
}

export function pause() {
  const t = get();
  if (t && t.startedAt) put({ ...t, accumulatedMs: elapsedMs(t), startedAt: null });
}

export const clear = () => put(null);
/** Drop the timer if it belongs to this ticket (it was finished or skipped). */
export function clearFor(id) { if (forTicket(id)) clear(); }

async function saveAndClear(t) {
  const mins = minutesFor(t);
  if (mins > 0) await patchTicket(t.ticketId, { minutes_spent: t.baseMinutes + mins }).catch(() => {});
  put(null);
}
