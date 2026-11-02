# UI redesign spec: Linear-style SaaS shell

Goal: dsaMixer should feel like a polished SaaS product (reference: Linear). Today it looks like a tidy Jira clone. This is a redesign, not a polish pass: the visual change should be obvious at a glance. The owner chose:
- a Linear-style look
- a sidebar app shell
- widget-based pages
- reusable component code
- a customizable dashboard
- small flow improvements

Read CLAUDE.md first (code map, conventions, "never test against the real database").

## Constraints
- Vanilla ES modules and plain CSS. No frameworks, no build step, and no external scripts, fonts or CDNs; the app is local-only.
- Font stack: `"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Use Inter when it's installed. Tabular numbers on every figure.
- **The backend stays as it is.** Use the existing `/api` endpoints only (see `dsamixer/web/server.py`). If a flow truly needs a new endpoint, stop and describe it in your report instead of adding it. Don't touch Python.
- **Behaviour parity.** Everything that works today must keep working:
  - every route
  - drag-and-drop on Today and Week
  - the quick log when a dsa/review/upsolve card moves to Done: result, minutes, confidence, note. Spaced repetition depends on it.
  - the timer and its localStorage key `dsm.timer`
  - keyboard shortcuts (N, P, C, j/k, 1–8 or g-shortcuts, ?)
  - `?theme=` and the light/dark toggle
  - close day, then see tomorrow
  - AI week preview/apply, contests CRUD, settings save, sprint save
- `localStorage` is only for per-viewer UI prefs: theme, sidebar collapsed, widget layout. Wrap every access in try/catch, as `util.js` already does.
- Keep the module layout of `CLAUDE.md` (`js/views/*.js` export `render(root, arg)` and optional `destroy()`). Update the code-map row for `dsamixer/web/static/` in CLAUDE.md if files are added.

## 1. Component layer (do this first)
Create `js/components/` with small functions that return HTML strings (or elements), plus the CSS for each in `css/components.css`. Every view must be assembled from these; no ad-hoc markup for these patterns.
- `Button({label, icon, kind: primary|secondary|ghost|danger, size: sm|md, kbd})`
- `IconButton`
- `Badge` / `Pill` (kind, difficulty, status, carried)
- `Kbd`
- `Avatar`-style track dot
- `Widget({id, title, actions, body, footer})`: the standard card with a header (small title, optional action link or menu) and a body.
- `Stat({label, value, sub, trend})`
- `Meter({label, used, cap})`: overage shown as text plus an icon, never stripes.
- `ProgressRing`
- `EmptyState({icon, title, hint, action})`
- `Tabs` / `Segmented`
- `Table`
- `Card` for a ticket, with a compact and a regular variant.
- `Toolbar` (page header: title, sub, actions)
- `SlideOver` (right panel)
- `Menu` / `Dropdown`
- `Toast`

Existing helpers in `ui.js` (`openDialog`, `openDrawer`, `toast`, `kpi`, `meterHtml`, `kindChip`, `diffPill`) should either become these components or re-export them, so nothing breaks.

## 2. Visual language (`css/tokens.css`)
- **Neutrals:** a cool-grey ramp. Light theme: app background `#f7f7f8`, surface `#fff`, sidebar `#fbfbfc`. Dark theme: background `#0e0f11`, surface `#16171a`, raised `#1c1d21`. Borders are 1px, at `rgba(0,0,0,.08)` in light and `rgba(255,255,255,.07)` in dark.
- **One accent:** indigo/violet, about `#5e6ad2`, used for primary buttons, focus rings, the active nav item and links. Track colours are muted and used only as small dots or stripes: DSA blue, AI amber, Review violet, Contest green. Difficulty pills are soft tints.
- **Type:** 13px base UI text, 12px meta, 15px card titles, 20px page titles, 28–32px hero numbers. Weights 400/500/600. Letter-spacing -0.01em on headings.
- **Radius:** 6px on controls, 8px on cards, 12px on widgets.
- **Shadows:** barely there. Hover lifts by one step. Popovers and slide-overs get a real shadow plus a backdrop blur.
- **Motion:** 120–180ms ease-out; respect reduced motion.
- **Density:** compact like Linear. 32px rows, 28px buttons, generous whitespace between widgets but not inside them.
- **Dark theme:** first-class and designed, not inverted. Body text contrast at least 4.5:1.

## 3. App shell
- **Left sidebar**, 232px, collapsible to a 56px icon rail. The collapsed state is remembered.
  - Top: logo and "dsaMixer".
  - Workspace nav with icons: Today, Week, Sprint, Stats. A "Practice" group: Questions, Contests. A "Course" group: AI course. Settings at the bottom.
  - Bottom: the running-timer pill (live clock, click to open the card), the streak, and the theme toggle.
- **Top bar in the content area:** breadcrumb/page title, a search button showing "⌘K", and page actions.
- **Command palette (⌘K / Ctrl+K):** fuzzy search over:
  - navigation
  - actions: new card, pull next question, close day, toggle theme, start/pause timer, go to date
  - questions from `/api/questions`, matched by title or topic; selecting one opens it on LeetCode or shows its detail.

  Arrow keys plus Enter, Esc to close.
- **Mobile (<768px):** the sidebar becomes an off-canvas drawer behind a hamburger. No horizontal page scroll at 390px.

## 4. Pages as widget grids
Use a responsive 12-column grid. Each page is a `Toolbar` plus a grid of `Widget`s.

- **Today:**
  - Hero widget "Now": current card, a large timer, Start/Done/Skip.
  - Day meters widget: DSA, AI, Done.
  - Board widget: Kanban with swimlanes, To do / In progress / Done / Skipped, with dashed empty drop zones.
  - Side widgets: Knight tracker, Progress, This week's homework, Last 12 weeks heatmap.
- **Week:** a seven-column planner with a calm today highlight, compact cards, per-day meters, and drag between days.
- **Stats:** a KPI row of `Stat`s, then widgets: heatmap, rating line, time per day, by-topic progress.
- **Sprint, Contests, Questions, AI course, Settings:** rebuild them with the same `Toolbar`, `Widget`, `Table`, `EmptyState` and form components. Settings becomes grouped sections with a sticky save bar.

### Customizable dashboard
On Today and Stats, a "Customize" button in the toolbar enters edit mode. Each widget then shows:
- a drag handle to reorder (HTML5 drag)
- a hide toggle
- a size toggle where it makes sense (half or full width)

Hidden widgets are listed in an "Add widget" menu. The layout is saved to localStorage key `dsm.layout.<page>`. "Reset layout" restores the default. The Now and Board widgets can be reordered but not hidden.

## 5. Flow improvements (frontend only, existing API)
- **Card detail slide-over.** Clicking a card, or pressing Enter on a selected one, opens a right slide-over with:
  - title, kind, difficulty, topic/detail, LeetCode link
  - status as a segmented control
  - estimate and spent minutes, date (move to another day), note
  - the timer controls
  - history facts already in the ticket payload (carried count, result, confidence)
  - delete, with a confirm

  Edits go through `PATCH /api/tickets/{id}` or `DELETE`. Keep the existing quick-log popover for the drag-to-Done moment; the slide-over can also log.
- **Close day as a guided slide-over.** Step 1: summary of today (done, skipped, still open, which will carry over). Step 2: the evening log fields the current close-day drawer collects. Step 3: confirm, which calls the existing close endpoint, then shows "Tomorrow is planned" with a button to view it.
- **New card.** A small inline composer at the top of the To do column (title, kind, minutes; Enter to add), plus the existing N shortcut.
- **Toasts** show undo for status changes. Undo PATCHes the previous status back.

## 6. Process
1. Copy the scratch DBs:
   - `polish.db` to `redesign.db` (seeded data)
   - `fresh.db` to `fresh2.db` (new user)

   Both are in `/private/tmp/claude-501/-Users-prathamjain-Desktop-dsaMixer/87f9181f-6db8-4f7b-a6a7-db4f7d257b41/scratchpad`. Serve with `DSAMIXER_DB=<copy> .venv/bin/python -m dsamixer serve --port 8799`. Never use the real database or port 8765.
2. Build in this order: tokens, then components, then shell and palette, then Today, Week, Stats, then the remaining pages, then the flows.
3. Screenshot-check with headless Chrome (see CLAUDE.md) at 1440x900, light and dark, for Today, Week, Stats, and one of Contests/AI/Settings. Check 390px mobile with the CDP device-emulation script already in the scratchpad (`cdp.mjs`). Use at most 3 review rounds. Read each screenshot and fix what's off.
4. **Functional smoke test against the scratch server.** Drive these with CDP or by calling the API the UI uses, and confirm each change in `GET /api/day/...`:
   - Today loads with no console errors
   - moving a card to Done with the quick log
   - card slide-over edits a note
   - the close-day flow
   - the command palette opens and navigates
   - customize mode hides a widget and it stays hidden after reload
5. `node --check` every JS module (copy to `.mjs`). Stop the 8799 server at the end.

## Done means
A report with:
- the files added and changed
- the screenshot paths (Today light/dark, Week, Stats, one other page, mobile, new-user Today)
- the smoke-test results, each with pass/fail
- any parity gaps or skipped items, with the reason

A backup of the current UI is at `<scratchpad>/static-backup-polished`. Do not delete it.
