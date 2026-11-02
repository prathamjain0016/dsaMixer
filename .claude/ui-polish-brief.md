# UI polish brief (for the ui-polisher agent)

The UI works but looks "generated". Make it feel like a well-crafted Jira/Linear-quality product. Presentation only.

Setup:
- Copy `dsamixer.db` to a scratch path, seed it if it's sparse (see CLAUDE.md: simulate days with plan_day / update_ticket / close_day, add a few contests with ratings and a few `source='homework'` ai tickets), and run `DSAMIXER_DB=<copy> .venv/bin/python -m dsamixer serve --port 8799`.
- Screenshots: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --window-size=1440,900 --virtual-time-budget=5000 --screenshot=PATH "http://127.0.0.1:8799/?theme=light#/today"`. Use `theme=dark` for dark mode; the routes are #/today, #/week, #/stats, …
- Also screenshot a fresh copy of `dsamixer.db` without seeding, to check new-user empty states.

## Punch list

**Global / tokens**
1. **Type scale.** Typography hierarchy is flat. Define a clear scale (12/13/14/16/20/28) and consistent weights. Use tabular numbers for all figures and timers, and tighter letter-spacing on large headings. Section labels (lane names, panel titles, column headers) share one style.
2. **Spacing.** Use a consistent 4/8px rhythm for panel padding, the gaps between panels, and card internals. Align the right rail's top with the main column's top.
3. **Icons.** Replace the unicode glyph icons (‹ › ✓ ▶ ⏸ ↻ ⚠ 🔥 ☾ …) with one small inline-SVG icon set, defined once in a JS module and reused everywhere: stroke 1.75, currentColor, 16px. Keep the visible text labels.
4. **Elevation and borders.** One subtle card shadow, slightly stronger on hover and drag. Consistent 1px borders and radii: cards 8, panels 10, chips fully rounded.
5. **Interaction states.**
   - Every button, card and tab gets hover, active and focus-visible states.
   - Transitions run 120–160ms, and `prefers-reduced-motion` is respected.
   - The keyboard-selected card and drag-over columns get clear but calm styles.
6. **Buttons.** A consistent size scale (sm and md). Keyboard-hint chips (N, P, C) are lighter and aligned.

**Today**

7. **Brand.** A tidy "dsaMixer" wordmark with the accent on "Mixer", aligned with the nav.
8. **Now card.** It's the hero, so give it stronger hierarchy.
   - Balance the info on the left against the timer on the right.
   - The timer looks intentional: tabular digits and a subtle label.
   - The empty state ("Everything on this board is handled") feels friendly, not like an alert.
9. **Kanban.**
   - Empty columns get a light dashed drop zone with a short hint instead of dead space.
   - The Skipped column's hatch becomes subtle or plain.
   - Lane headers align with the column grid.
   - Card titles clamp at 2 lines, and detail text truncates cleanly.
10. **Cards.**
    - The kind chip, #id and difficulty sit on one quiet top row.
    - Difficulty pills are filled subtle tints, not outlines.
    - Refine the carried badge and confidence dots.
    - Done cards are muted but readable, not just struck through.
11. **Meter strip.** It's more compact. Overages use refined text and an icon instead of the loud yellow-black hazard stripe.
12. **Right rail.**
    - Knight tracker's new-user state shows a proper message ("No rated contests yet — your first live Weekly is Dec 6") with the target visible, not a lone dash.
    - Progress shows "0 / 507" well.
    - The mini heatmap is aligned to whole weeks, with weekday rows and a month label.
13. **Quick-log popover.** It's anchored so it doesn't cover its card: prefer below or right of the card, and flip when there's no room. Tidy its spacing and the segmented controls.

**Week**

14. **Day columns.**
    - Lighter headers, consistent meter rows, and a calm today highlight.
    - Overages get the same treatment as #11.
    - Compact cards stay readable.
    - "Not planned yet" looks like an empty state, not an error.

**Stats**

15. **Heatmap.** The 26-week heatmap fills the panel width (responsive cells), with aligned month and weekday labels.
16. **KPI tiles.** Consistent heights, a clear label/value/sub hierarchy, and tabular numbers.

**Dark theme**

17. **Contrast.** Check muted text, chips and borders in dark mode. Body text must be at least 4.5:1, and done or struck-through text stays readable.

**Mobile (390px)**

18. **Header.** The active tab is clearly marked, the nav has an edge fade so it's obvious it scrolls, and the header buttons don't wrap awkwardly.

## Done means
- `node --check` passes on every JS module (copy to .mjs if needed).
- The final screenshots are re-read after the last change: Today light/dark, Week light, Stats light, Today mobile, and Today in the new-user state.
- The 8799 server is stopped.
- A short report: what changed (by file), the screenshot paths, and anything skipped with the reason.
