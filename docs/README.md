# docs

Every document about dsaMixer lives here as Markdown, grouped by purpose. `CLAUDE.md` and `README.md` stay at the repo root.

| Folder | What goes here | Files |
| --- | --- | --- |
| (top level) | The short tour for people trying dsaMixer | [showcase.md](showcase.md) |
| `guides/` | How to install, set up, customise and extend dsaMixer | [getting-started.md](guides/getting-started.md) (includes the `/setup` command), [customise.md](guides/customise.md), [integrations.md](guides/integrations.md) (email, AI planner, LeetCode contest sync, profile and friends), [homework-agents.md](guides/homework-agents.md) |
| `architecture/` | How the system works today | [system-design.md](architecture/system-design.md) |
| `research/` | Investigations and options, not yet decided | [deployment.md](research/deployment.md) |
| `specs/` | Build specs and briefs handed to agents | [week-dsa-spec.md](specs/week-dsa-spec.md), [contest-sync-spec.md](specs/contest-sync-spec.md), [leetcode-profile-spec.md](specs/leetcode-profile-spec.md), [share-ready-spec.md](specs/share-ready-spec.md), [ui-redesign-spec.md](specs/ui-redesign-spec.md), [ui-polish-brief.md](specs/ui-polish-brief.md) |
| `images/` | Screenshots used by the README | today-light.png, week-light.png, stats-dark.png, wizard.png |
| (top level) | Parked ideas and deferred fixes | [BACKLOG.md](BACKLOG.md) |

The root also has `config.example.json` (documented in [customise.md](guides/customise.md)) and `.claude/commands/setup.md`, the `/setup` command for Claude Code.
