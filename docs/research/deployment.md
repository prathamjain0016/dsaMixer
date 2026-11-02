# dsaMixer deployment research

As of 2026-11-02. Goal: share a link so that **other people each get their own copy, with their own data**, writing as little code as possible.

## Summary

The recommended path costs $0 a month and about 1–1.5 days of work (150–250 lines): **a Render free web service, Neon free Postgres and Google login through Authlib, with one Postgres schema per user.** None of the app's ~95 SQL statements has to change, because every request already goes through a single `conn()` helper, and that helper can switch to the user's schema.

In v1:
- Other users get the board, planner, stats and contests.
- The AI planner stays owner-only, because it bills the owner's key.
- Email is off.
- The homework agents stay local on the owner's Mac.

| Tier | What people get | Code | Catch |
| --- | --- | --- | --- |
| 0 · Share the repo | Each person runs `./run.sh` locally on SQLite | None | Needs Python and a terminal |
| 1 · Deploy-to-Render button | Each person deploys their own copy with one click | About 30 lines plus `render.yaml` | Two sign-ups per person (Render and Neon), a public repo, no automatic updates |
| 2 · One shared app (recommended) | A link with Google sign-in and separate data per user | 150–250 lines | Cold start of about 1 minute after 15 minutes idle |

Whichever tier you pick, the hosted app needs a timezone fix. Servers run on UTC, so without it the board would show yesterday as today between 00:00 and 05:30 IST.

## What has to change in the app

Giving each user their own Postgres schema is the smallest change that keeps everyone's data apart: about 40–80 lines, with no changes to any query.

What the code looks like today (counted from the repo):
- 9 tables, 8 of which hold user data
- about 95 SQL statements
- 36 functions that take `conn`
- 1 connection helper that all 25 API routes go through

| Option | What changes | Size | Main risk |
| --- | --- | --- | --- |
| Schema per user (recommended) | `connect()` runs `SET search_path TO u_<hash>` and `SET TIME ZONE`, and seeds a new schema on first login | 40–80 lines | Must use Neon's direct connection, because its pooler drops session settings. Migrations must run on every schema |
| `user_id` column plus a filter | 8 tables, 5 primary keys, 7 upserts, ~95 queries and 36 functions all change | 400–600 lines, 3–5 days | One missed `WHERE` shows another user's data |
| Postgres row-level security | The same columns and keys as above, plus a policy per table | 120–200 lines | Needs a non-owner database role, and SQLite tests can no longer check isolation |
| One instance per user | Only a password gate and timezone env vars | 20–40 lines | No updates once deployed, and each person needs accounts |

**Other changes:**

- **Timezone:** add a `timezone` setting that defaults to `Asia/Kolkata`. Route the 13 `date.today()` calls through one `today()` helper, and run `SET TIME ZONE` on each connection. If every user is in IST, setting the `TZ` and `PGTZ` env vars works as a stopgap. That's standard behaviour but not yet tested here.
- **New-user defaults:** the AI-class template (Sat/Sun 8:00–11:30), the IST contest text and `course_week_offset` are specific to the owner. New users need neutral defaults instead, about 1–2 hours of work.
- **Email:** off for other users in v1. To add it later, build a secret-protected `/api/cron/notify` endpoint and trigger it from a free GitHub Actions schedule. Render's cron costs at least $1 a month per job.
- **AI key:** the planner bills the owner's OpenRouter key on every click. Make it owner-only for now with an email allowlist (about 5 lines). A bring-your-own-key option can come later.
- **Homework agents:** stay local and owner-only. They need the Mac, the notebooks and the `claude` CLI.
- **Question list:** the 507 questions come from the owner's PDF. Before going public, check whether that list may be shared. That's a legal question, not a technical one.

## Hosting options

Render's free web service with Neon's free Postgres is the cheapest pair that keeps data permanently. Avoid Render's own free Postgres: it expires after 30 days and is deleted 14 days later.

| Platform | Free tier | Idle behaviour | Scheduled jobs | Card |
| --- | --- | --- | --- | --- |
| [Render](https://render.com/docs/free) web | 750 h a month, 0.1 CPU, 512 MB | Sleeps after 15 min, about 1 min to wake | None free; [cron](https://render.com/docs/cronjobs) from $1 a month per job | Needed to avoid suspension on overages |
| [Neon](https://neon.com/pricing) Postgres | 1 GB and 100 CU-hours per project per month | Scales to zero after 5 min | n/a | No |
| [Supabase](https://supabase.com/pricing) | 2 projects, 500 MB database, 50k auth users | Pauses after 1 week inactive | Not checked | Not stated |
| [Railway](https://railway.com/pricing) | $5 one-time trial; Hobby is $5 a month | Not stated | Yes, in UTC | No card for the trial |
| [Koyeb](https://www.koyeb.com/pricing) | 1 small service; Postgres capped at 5 active hours | Scales to zero after 1 h | Not checked | Unverified |
| [Cloud Run](https://cloud.google.com/run/pricing) | 2M requests a month; no lasting free SQL | Scales to zero | Not confirmed | Billing account required |
| [Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing) Hobby | 4 CPU-hours a month | Per-request functions | Daily only, ±59 min | Not checked |
| [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) | Arm VM with 4 OCPU / 24 GB (a reported 2026 cut is unverified) | Always on; idle VMs may be reclaimed | Your own crontab | Conflicting reports |
| [Fly.io](https://docs.fly.io/about/pricing) | No free tier; the smallest machine is about $2.19 a month | Can auto-stop | Not checked | Yes |

If a one-minute cold start each morning is too annoying, Railway Hobby at about $5 a month is the step up. That figure is an estimate.

## Auth options

Google sign-in through Authlib, with a server-side session cookie, takes the least code: about 50–70 Python lines plus 5 in `api.js`. It needs no JS SDK and no ORM.

| Option | Free limit | Rough code | Fit |
| --- | --- | --- | --- |
| Authlib with Google OAuth (recommended) | Free with a Google OAuth client; the test-user limit (about 100) is unverified | 50–70 lines | Best fit; the raw-SQL backend stays as it is |
| [Cloudflare Access](https://www.cloudflare.com/plans/zero-trust-services/) | Up to 50 users | 20–30 lines to verify its JWT | Needs a custom domain on Cloudflare; good as an extra gate |
| [Supabase Auth](https://supabase.com/docs/guides/auth/jwts) | 50k monthly active users | About 30 Python and 40 JS lines | Fine if Supabase is also the database; pauses after a week idle |
| [Clerk](https://clerk.com/pricing) | 50k monthly retained users, with Clerk branding | About 30 Python and 30–40 JS lines | Good, but adds a JS SDK |
| [Firebase Auth](https://firebase.google.com/pricing) | 50k monthly active users, no card | About 25 Python and 40 JS lines | Adds Google SDKs on both sides |
| [Auth0](https://auth0.com/pricing) | 25k monthly active users, no card | About 60 lines | Heavier than plain Google |
| [fastapi-users](https://fastapi-users.github.io/fastapi-users/latest/) | Free | 150+ lines plus an ORM | Poor fit: in maintenance mode and ORM-only |

Whichever option you pick, add an email allowlist env var so strangers can't create accounts during the beta.

## Plan for the recommended path

About 1–1.5 days in total.

1. **Repo hygiene (0.5 h).** Keep `.env`, `dsamixer.db`, `homework/`, `logs/` and the PDF out of the deployed repo. Decide whether the question list can be shared.
2. **Timezone (1–2 h).** Add the `timezone` setting and a `today()` helper, and run `SET TIME ZONE` on each connection.
3. **Schema per user (1–2 h).**
   - `connect(user)` creates the user's schema on first use, sets `search_path` and seeds the 507 questions.
   - Schema names are `u_` plus a hash of the Google ID, never raw input.
4. **Auth (2–3 h).** Authlib Google login, `SessionMiddleware`, an email allowlist, and a redirect to `/login` on a 401.
5. **Gating (0.5 h).**
   - Drop the startup plan.
   - Make the AI planner owner-only.
   - Keep email and the schedule CLI-only.
6. **Neutral defaults for new users (1–2 h, optional).**
7. **Tests (1 h).**
   - Simulate two users on scratch SQLite files and confirm neither sees the other's data.
   - Re-read the new SQL against the Postgres portability rules.
8. **Deploy (1–2 h).**
   - Create a Neon project and use its direct connection string.
   - Create a Google OAuth client.
   - Create a Render free web service with the start command `uvicorn dsamixer.web.server:app --host 0.0.0.0 --port $PORT`.
   - Moving the owner's data to Neon needs the owner's go-ahead and a `pg_dump` backup first.

**Deploy-button alternative (about half a day):**
- A `render.yaml` with `plan: free` and auto-deploy off. `DATABASE_URL` and `APP_PASSWORD` are prompted for at the first deploy ([Blueprint spec](https://render.com/docs/blueprint-spec), [deploy button](https://render.com/docs/deploy-to-render)).
- `TZ`/`PGTZ` env vars.
- A basic-auth middleware of about 15 lines.

**Risks:**
- Render cold starts take about 1 minute.
- Schema migrations must loop over every user.
- Connection limits on Neon's direct endpoint weren't checked.
- A public repo exposes the code and possibly the question list.

**Open question:** should the owner's own board move to the hosted app, or stay on local Postgres with the hosted copy only for others?

## Sources

All accessed 2026-11-02:
- Render: [Render free](https://render.com/docs/free), [Render cron](https://render.com/docs/cronjobs)
- Neon: [Neon pricing](https://neon.com/pricing), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- Supabase: [Supabase pricing](https://supabase.com/pricing)
- Auth providers: [Clerk pricing](https://clerk.com/pricing), [Auth0 pricing](https://auth0.com/pricing), [Firebase pricing](https://firebase.google.com/pricing)
- Railway: [Railway pricing](https://railway.com/pricing), [Railway cron](https://docs.railway.com/reference/cron-jobs)
- Koyeb: [Koyeb pricing](https://www.koyeb.com/pricing)
- Google Cloud: [Cloud Run pricing](https://cloud.google.com/run/pricing), [Google Cloud free tier](https://docs.cloud.google.com/free/docs/free-cloud-features)
- Vercel: [Vercel limits](https://vercel.com/docs/limits)
- Fly.io: [Fly.io pricing](https://docs.fly.io/about/pricing)
- Hugging Face: [Hugging Face Spaces](https://huggingface.co/docs/hub/spaces-overview)
- GitHub: [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
