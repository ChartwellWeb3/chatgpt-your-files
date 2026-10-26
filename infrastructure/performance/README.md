# Website performance Supabase project

This directory owns the separate Supabase setup for website performance. The existing Next.js frontend and login are shared with the chatbot application.

## Project ownership

| Original project (`supabase/` at the repository root) | New performance project (this directory) |
| --- | --- |
| Auth, users, profiles, access levels | Website deployment records |
| All chatbot conversations, visitor data, and chatbot analytics | Lighthouse device/measurement attempts |
| Residences, documents, embeddings, Storage | Per-page performance metrics and full result JSON |
| Existing chatbot Edge Functions and scheduled jobs | Deployment commit history and future performance ingestion |

The new project's expected tables are `performance_deployments`, `performance_runs`, `performance_page_results`, and `performance_deployment_commits`. Their actual definitions, indexes, constraints, triggers, and functions must be inspected before the initial schema migration is written.

## Preparation status

Included:

- An independent `supabase/config.toml` and ignored local project-link metadata.
- Empty `supabase/migrations/` and `supabase/functions/` folders, retained with `.gitkeep` files.
- A server-only performance client and a performance API that checks login in the original project before querying this project.
- Separate CLI scripts and environment placeholders.

The complete initial schema migration, historical data copy, ingestion function, and collector configuration are outside this setup. Supplying credentials alone does not create the required database tables. The additive trend-function script below targets the existing performance tables inspected through the configured project's API.

## Install dashboard calculation functions

Open [sql/performance-trends.sql](sql/performance-trends.sql) and run the entire script in the **website performance project's SQL Editor**, then deploy/restart the updated app. It installs the dashboard RPCs and their shared helpers in one transaction. It is repeatable and does not update/delete measurements. Execute privileges are limited to `service_role`; all viewer requests pass through the app's original-project login check.

| RPC | Backend work |
| --- | --- |
| `performance_overall_trend` | Comparable deployment selection, score averages, coverage, and gap reasons. |
| `performance_page_trend` | Page identity matching, eligibility, and historical page scores. |
| `performance_run_summaries` | Device averages and measured, included, noisy, failed, and regression counts, over all stored pages for each requested attempt. |
| `performance_page_results_page` | Search, device filtering, metric sorting, total count, pagination, metric normalization, and eligible stored score deltas. |

The overview returns `runSummaries` and empty compatibility arrays for `pages`/`historyPages`. The table requests eight rows at a time through `view=pages`; it fetches full report JSON only when a row is expanded. Page searches are debounced by 250 ms, and stale network requests are cancelled. Counts and averages do not depend on which table page is visible.

Both trend RPCs select one attempt per deployment/device and compute scores in PostgreSQL. They compare measurement settings and toolchain versions while allowing Node minor/patch updates within a major version. Completed scores are included even when samples vary or consistency is unknown. Incomplete ingestion, genuinely different configurations, and page identity changes remain gaps. Charts show values without trust-status labels or consistency warnings. Device summaries and stored score deltas keep their existing consistency checks. Missing functions produce a setup error.

This is a SQL Editor installation script, not a replacement for an initial schema migration. Do not run an empty project's `db push` expecting it to install the existing performance schema. Fold these definitions into the performance migration history when that full schema is captured.

## Application environment

Keep these assigned to the original project:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_DB_URL=...
```

After creating the new project, add its values to `.env.local` and the app hosting environment:

```dotenv
PERFORMANCE_SUPABASE_URL=https://NEW_PROJECT_REF.supabase.co
PERFORMANCE_SUPABASE_SECRET_KEY=...
PERFORMANCE_ENVIRONMENT=qa
```

Use the new project's server `sb_secret_...` key. A legacy `service_role` key is also accepted by the client. Never put the secret in source control or a `NEXT_PUBLIC_` variable. The CLI database password and project link are configured separately from these runtime values. Restart local development or redeploy the application after changing its environment.

Set `PERFORMANCE_ENVIRONMENT=qa` on the QA app deployment and `PERFORMANCE_ENVIRONMENT=prod` on production. This server-only setting is required; values are trimmed and normalized to lowercase. The dashboard shows QA/PROD as a static badge, with no environment selector. Its deployment/history queries always use the configured value and ignore an `environment` query parameter. The server-rendered page uses the same setting at request time, so the label and API filter share one source. Missing or invalid values produce a setup state rather than selecting another environment.

The setting must match `performance_deployments.environment` values written by ingestion. It does not select a Supabase project or rewrite existing DEV records; the project URL and key determine the database connection.

Missing performance values return an explicit `503` setup error to signed-in viewers. The helper also rejects the original project's URL. It never falls back to the old database. Other application features continue to use their existing configuration.

## Login and data access

```text
Browser -> /api/performance
             -> original project's cookie-based client: auth.getUser()
             -> new project's server client: performance table queries
             -> existing dashboard response
```

All signed-in application users can view performance. The new project does not need duplicate users or profiles. Its server key bypasses RLS, so every performance API mode must retain the original-project authentication check. The performance client is marked `server-only`, has session persistence/refresh disabled, receives no viewer token or cookies, and disables fetch caching.

When the schema is added, configure grants and RLS for server access and keep anonymous/browser access closed. Do not add policies that expect an original-project session to authenticate automatically in the new project, or foreign keys to the original project's profiles/users.

## Independent CLI setup

Run commands from the repository root. The npm scripts select the workdir explicitly:

```powershell
# Original project: login, chatbot data/content, chatbot analytics
npm run supabase:chatbot -- migration list

# New project: link only this setup after creating the hosted project
npm run supabase:performance -- link --project-ref NEW_PROJECT_REF
npm run supabase:performance -- migration list
```

Each setup stores its own hosted-project link under its ignored `supabase/.temp/` directory. Do not relink the original setup to deploy performance changes. The `project_id` in this config is a local stack name, not the hosted project reference. Runtime environment variables do not select the CLI's migration target.

Future performance SQL belongs only in `infrastructure/performance/supabase/migrations/`. Existing applied migrations in the root `supabase/migrations/` remain immutable and assigned to the original project. The new project will start with an initial migration containing the actual performance schema and dependencies, followed by new timestamped migrations for later changes. It will maintain its own migration history.

When actual migrations are ready, review pending migrations for the intended project before applying them:

```powershell
npm run supabase:performance -- db push --dry-run
npm run supabase:performance -- db push
```

No migration command is run by the application or these documentation changes. Edge Functions require their own deployment and secrets; applying database migrations does not deploy them.

## Local development and types

The separate local stack uses API port `25431`, database port `25432`, shadow database port `25430`, and Studio port `25433`. These avoid the ports in the original project's configuration. Match `db.major_version` to the new hosted database before starting local development.

Local Auth, Storage, Realtime, analytics, and the Edge Runtime are disabled because this scaffold only needs database/API access. These settings do not change hosted project settings. Enable the Edge Runtime when an actual performance function is introduced. Seed execution is disabled while the schema is pending.

After the performance schema exists and its local stack is running, the separate type-generation command is:

```powershell
npm run gen:types:performance
```

It writes `infrastructure/performance/database.types.ts`. The existing `npm run gen:types` continues to write the original chatbot types. No generated performance type file is provided before the actual schema exists; the dashboard currently uses its existing types in `lib/performance.ts`.

## Remaining cutover work

1. Create the new hosted Supabase project and configure its application environment values.
2. Inspect the actual performance schema, then author and apply the initial migration in this setup.
3. Copy existing performance history, preserving UUIDs, timestamps, relationships, and JSON baseline references. Coordinate the final copy with collector writes so no measurements are missed.
4. Configure/deploy the performance ingestion endpoint and switch only the performance collector to the new destination. Keep chatbot jobs assigned to the original project.
5. Confirm ingestion and dashboard results after the data/schema are ready. Retain the old performance copy during the transition; any cleanup is a separate later change.

See the [dashboard README](../../app/chartwell-website-performance/README.md) for visible/hidden fields, calculations, query limits, and UI behavior.
