# Sitecore pricing: DEV / QA / PROD — automatic Edge imports

The flow is **choose XLSX → Run → progress 0–100% → results**. DEV and QA apply eligible changes when you click Run. Selecting PROD first opens a warning; every PROD run or retry then requires confirmation showing the workbook and target CM host. Confirmation is checked by the authenticated API and stored with actor, time, and configuration hash in Supabase; the Edge Function will not claim an unconfirmed PROD job. Validation and authoring snapshots still happen internally before applying. An error on one target does not block unrelated valid targets; a connection/authentication outage stops the job for an explicit Retry.

The **Developers** tab appears only when an import has actual issues or warnings. It contains paginated matching/lock/conflict/input errors, formula warnings, and job diagnostics. It is available to the same authorized Admin/Content Team accounts; it is not a new user role. Empty updates, missing EN/FR versions, and absent care-level folders remain neutral skips and do not create that tab.

The original chatbot project supplies login and Suite Pricing grants. Admins always have access. Content Team users require `profiles.feature_access.sitecore_pricing = true`, controlled by the **Suite Pricing** switch in Team Management; Basic users remain ineligible. All pricing tables, RPCs, catalog checkpoints and audit data belong to the separate **performance** Supabase project. Level 3 is denied. Browser code never gets a Supabase service key, Sitecore credentials, or dispatch secret.

## Team access setup (original chatbot/Auth project)

Run `supabase/migrations/20261116170000_add_sitecore_pricing_feature_access.sql` from the repository root in the **original chatbot/Auth project's SQL Editor** (the project configured by `NEXT_PUBLIC_SUPABASE_URL`). This is a separate target from the pricing-data SQL below. The script installs or extends feature grants and the admin-only `set_profile_feature_access` RPC. Existing Admin/Content Team users keep pricing access, existing Performance/AI Visibility grants are preserved, and new users default all grants off. Rerunning preserves saved grants and revocations. Deploy/restart the app afterward; no pricing Edge Function redeployment is needed for the access toggle.

In **Team Management → Suite Pricing**, admins can turn access on/off for Content Team users. Admin access is always enabled; Basic users show an unavailable switch because their role cannot use this section. Revoked users lose navigation, page and API access (including uploads, commands, exports and history deletion). All checks use the original profile before opening the performance database. Previously authorized background imports continue independently; changing access does not cancel or undo them.

## Install or repair the database

Use **one SQL file**: `sql/20261116160000_pricing_environments_complete.sql`. It includes every pricing prerequisite and the current multi-environment, production confirmation, Edge, skip, shared-ID, diagnostics and deletion functions. It works with fresh, partial or complete pricing installations. No earlier pricing scripts need to be run first.

This resolves both observed errors: `execution_mode already exists` and `Missing pricing prerequisites`. Existing columns are retained; missing objects are added. Import IDs, source rows, snapshots, results, actors and active leases are preserved. The script does not run/approve imports, delete import history, call Sitecore or change Cron/Vault settings. Previously supplied SQL files remain immutable history.

1. In the **performance project's SQL Editor**, run the **entire** complete script. Use the project configured by the app's `PERFORMANCE_SUPABASE_URL`, not the chatbot/login project.
2. Its final `pricing_setup` result should show `ready: true` and `missing: []`. Allow the schema cache a few seconds to reload, then refresh/restart the app. If it still reports `sitecore_pricing_schema_status()` missing, check that the app and SQL Editor use the same performance project.
3. Redeploy the updated Next.js app and `sitecore-pricing` Edge Function together. Earlier DEV-only function code cannot process QA/PROD. The same function handles all configured environments; you do not need a separate Supabase project/function/schedule for each Sitecore environment.
4. Configure the app and Edge secrets below. In **Edge Functions**, open the existing **`sitecore-pricing`** function, or create it via the Editor if absent, and paste the entire `deploy/sitecore-pricing.dashboard.ts` into `index.ts`. Deploy with **Verify JWT OFF**. The handler verifies its private dispatch secret before any database/Sitecore access.
5. Keep existing valid Vault values. If absent, in **Integrations → Vault**, add `pricing_project_url` = the performance project URL (for example `https://YOUR-REF.supabase.co`) and `pricing_dispatch_secret` = the same random value used as `SITECORE_PRICING_DISPATCH_SECRET` on the app and Edge Function.
6. If the recovery schedule is not already installed, run `sql/20261116121000_pricing_activate_edge_cron.sql` after function/Vault setup. It enables independent recovery every minute.
7. Restart the app after setting its environment variables. Select DEV, choose a small workbook and click **Run**. Then test QA with its own credentials. For PROD, verify the displayed host and scope before confirming a small run. Upload separate imports for each environment; switching the dropdown never retargets a saved import. Historical manual imports are never auto-approved; upload them again to use the automatic flow. Stop any retired local pricing worker before the cutover and allow its in-flight operation to finish.

The trash icon beside each recent import permanently deletes its source rows, catalog checkpoints, results, and before/after snapshots after confirmation. Admin and Content Team accounts can delete. A live batch lease blocks deletion; queued, paused or expired imports can be removed atomically before another claim. Deletion stops remaining work without reverting Sitecore prices or publishing. Stranded manual imports with expired leases can also be deleted.

Files are prepared locally; no hosted SQL execution, function deployment or Sitecore price update is performed by preparing them. Installing only the Edge Function is insufficient; the app/function need matching settings and the database objects above.

## App environment and Edge secrets

Keep the app's original `NEXT_PUBLIC_SUPABASE_*` settings for chatbot login, and its existing `PERFORMANCE_SUPABASE_URL` / `PERFORMANCE_SUPABASE_SECRET_KEY` for the separate database. No change to `PERFORMANCE_ENVIRONMENT` is needed; the pricing dropdown is independent of website-performance environment selection.

Set these exact settings on **both** the Next.js server (`.env.local` locally) and **performance project → Edge Functions → Secrets**:

```dotenv
# Shared across DEV, QA, and PROD. Optional environment-specific overrides win.
SITECORE_PRICING_PROPERTY_TEMPLATE_ID={8A4FBFEA-94DC-41CF-B6B8-CECA339490B1}
SITECORE_PRICING_SUITE_TEMPLATE_ID={CB593602-63B9-4ACF-B9C7-3E2A56AEFCC1}
SITECORE_PRICING_CONTENT_ROOT=/sitecore/content/sxastarter/sxastarter/home
SITECORE_PRICING_TIMEZONE=America/Toronto

# Each environment has its own CM host and environment automation client.
SITECORE_PRICING_DEV_CM_URL=https://xmc-chartwellmaa139-chartwellsxa-dev.sitecorecloud.io
SITECORE_PRICING_DEV_CLIENT_ID=
SITECORE_PRICING_DEV_CLIENT_SECRET=

SITECORE_PRICING_QA_CM_URL=https://xmc-chartwellmabc8a-chartwellsxa-cwqa.sitecorecloud.io
SITECORE_PRICING_QA_CLIENT_ID=
SITECORE_PRICING_QA_CLIENT_SECRET=

# Use the verified PROD CM origin, with no /sitecore path or query string.
SITECORE_PRICING_PROD_CM_URL=
SITECORE_PRICING_PROD_CLIENT_ID=
SITECORE_PRICING_PROD_CLIENT_SECRET=

# Optional override example: SITECORE_PRICING_QA_CONTENT_ROOT=/sitecore/content/...
# Same random 32+ character secret in Next.js, pricing Edge Function, and Vault.
SITECORE_PRICING_DISPATCH_SECRET=
```

Configure the three **environment-specific** settings (`CM_URL`, `CLIENT_ID`, `CLIENT_SECRET`) separately for DEV, QA and PROD. Define the four **shared** template/root/timezone settings once for all three environments:

| Setting suffix | What to use |
| --- | --- |
| `CM_URL` | That environment's HTTPS Content Management origin, without `/sitecore/...` or query parameters. The DEV and QA URLs above are the ones you provided. Supply and verify the PROD URL. |
| `CLIENT_ID` / `CLIENT_SECRET` | A separate environment automation client created in Sitecore Deploy for that environment, with Authoring and Management API access. Keep credentials in server secrets. |
| `PROPERTY_TEMPLATE_ID` | The shared **PropertyPage template definition** Item ID. |
| `SUITE_TEMPLATE_ID` | The shared **SuitePlan template definition** Item ID. |
| `CONTENT_ROOT` | The intended allowed subtree, such as `/sitecore/content/sxastarter/sxastarter/home/ab/calgary` for initial testing. |
| `TIMEZONE` | `America/Toronto`, unless that environment requires another promotion timezone. |

Use identical shared values in the app and Edge secrets. `SITECORE_PRICING_PROPERTY_TEMPLATE_ID`, `SITECORE_PRICING_SUITE_TEMPLATE_ID`, `SITECORE_PRICING_CONTENT_ROOT` and `SITECORE_PRICING_TIMEZONE` apply to **DEV, QA and PROD**. An environment-specific override, such as `SITECORE_PRICING_QA_CONTENT_ROOT`, takes priority over its shared value; remove old overrides in both locations if you want the shared value to apply. Hosts and credentials never fall back to shared or DEV settings. A missing environment shows its setup instructions and disables Run while other configured environments remain usable. Start by configuring DEV/QA; PROD can remain empty until ready. Different environment labels cannot point to the same configured CM origin. This configuration change requires an app restart/redeployment and a regenerated Edge Function redeployment, but no new SQL, Cron or Vault changes. Existing imports remain valid when their resolved configuration values are unchanged; changed template/root/timezone values require a new upload.

Get the automation credentials from Sitecore Deploy for the selected environment, under its credentials area, choosing **Create credentials → Automation**. [Sitecore environment credentials documentation](https://doc.sitecore.com/sai/en/developers/sitecoreai/deploying-sitecoreai/deploy-app/managing-sitecoreai-client-credentials/manage-client-credentials-for-a-sitecoreai-organization-or-environment.html). For hosted Supabase secrets, use [Edge Functions → Secrets](https://supabase.com/docs/guides/functions/secrets).

Generate the dispatch secret once in a password manager, use the same value in all three locations (app, Edge, Vault), and never put it in a `NEXT_PUBLIC_` variable or paste it into chat. Vault uses the name `pricing_dispatch_secret`; the app and Edge use `SITECORE_PRICING_DISPATCH_SECRET`.

The function uses Supabase's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for its own performance project. Do not replace these with chatbot-project credentials, and do not copy the original chatbot Auth keys to this function. All user authentication remains in the Next.js API.

Use a separate **environment automation client** for each environment from Sitecore Deploy. `SITECORE_EDGE_CONTEXT_ID` and the Experience Edge delivery URL cannot perform authoring writes. The authoring endpoint is `<selected-CM-origin>/sitecore/api/authoring/graphql/v1/`; the importer uses short-lived OAuth client-credential tokens.

Verify both template definitions in each environment; IDs may be identical when serialized, but must be checked. Reference screenshots showed PropertyPage `{8A4FBFEA-94DC-41CF-B6B8-CECA339490B1}` and SuitePlan `{CB593602-63B9-4ACF-B9C7-3E2A56AEFCC1}`. These are references to verify, not hardcoded defaults. `SuiteType` is not the SuitePlan price template. Authoring schema introspection and appropriate update/workflow permissions must be available to the integration.

## How processing and progress work

The application saves normalized source rows and the Run actor/time, then makes a private call to the Edge Function. The function claims one job, processes a bounded batch, saves checkpoints, releases its lease, and requests another invocation. Cron independently recovers a lost continuation or killed function. The browser only reads progress; it is not responsible for keeping the job alive. No local worker needs to run.

Catalog folder pages and discovered residence IDs/PropertyIDs are persisted transactionally. Catalog scanning does not restart from the beginning after an invocation ends. All matched residences are expanded into separate targets before price validation and application. Expiring, exclusive leases serialize imports to the same CM host. Claims are scoped by both environment and configuration hash. Independent environments can progress concurrently; the empty Cron invocation checks all configured environments, while an app Run wakes its selected environment. Each batch has a 95-second soft deadline and avoids starting another Sitecore request near that boundary. A deadline is a pause, not a row error; a hard platform interruption is recovered after the 180-second lease expires. Supabase still imposes execution limits on background work.

The saved percentage is monotonic during a run: discovery 1–15%, target expansion 15–20%, validation 20–60%, applying/verification 60–99%, finished 100%. It measures completed stages/targets rather than elapsed time. Discovery's denominator can grow, and the displayed percentage holds its high-water mark. Target totals can increase when several residences share a Yardi ID. Retrying an interrupted run starts its progress at the relevant phase.

**100% means every target has a terminal result, not that every price changed.** A completed import can include updated, unchanged, skipped, or issue rows; the Developers tab and downloadable CSV show the details. A job-level outage stays below 100% until it is resolved or cancelled. Files containing only empty/invalid source rows complete immediately without Sitecore requests.

The local `sitecore:pricing-worker` launcher is retired and only prints a cutover message. Its old claim RPC is disabled by the update. Historical manual jobs are never claimed by the Edge Function. Do not force-expire an active lease to accelerate an import.

## Workbook rules and matching

Reads only the `Market Rates and Business Cases` sheet, locating headers in its first 30 rows. Required headers: `Web Property ID - Yardi Number`, `Residence`, `Marketing Care Level`, `Web SuiteTitle`, `Regular SuitePrice`, `PromotionPrice`, `Start Date`, `End Date`. Maximum 10 MB compressed XLSX and 5,000 source rows, with bounded decompressed XML. Workbook notes are data, not instructions. Formulas and external links are never executed; saved formula values produce developer warnings, while missing/error results block that row.

- Match **every** PropertyPage with the uploaded shared `PropertyID` within the configured root; each source row/residence/language has its own durable target. The function scans the configured root to build the catalog, but only uploaded IDs receive targets or writes. A 10-residence workbook does not update other residences.
- Discover through up to four container levels. A restricted Calgary root cannot match residences outside Calgary. Use the full home root for a national workbook, or a workbook containing only the intended scope.
- Resolve `<residence>/Data/SuitePlans/<care level>` and the configured SuitePlan template ID. Supported care folders: `il`, `al`, `mc`, `sa`, `ltc`.
- Match case-insensitively with explicit aliases: `studio`/`studios`, `1bed`/`1 bed`, and `2bed`/`2beds`/`2bedroom`/`2 beds`. Multiple equivalent SuitePlan items in one folder remain blocked, as do duplicate nonempty Excel matching keys. Missing suite names remain issues.
- Read existing latest EN and FR versions independently. Missing/fallback languages and missing care-level folders are neutral skips. Never create language versions or unlock content.
- Blank price/date cells preserve values. All four blank inputs are skipped; malformed prices/dates/formulas remain errors. Only regular price, promotion price, start date and end date are writable.
- Prices must be positive, at most 1,000,000, with at most two decimals. A promotion above regular price warns but does not block valid updates. Promotions need both resulting dates, with end on/after start.
- Excel 1900/1904 dates and ISO date strings are supported. Dates use the configured timezone; the end date includes 23:59:59. Stored Sitecore dates are UTC. Ambiguous date strings and date/time fractions are rejected.

The original workbook is not retained; its hash, source rows, snapshots, actor IDs and outcomes are retained in the performance database. The CSV includes matched paths, before/after fields, issues and warnings, and escapes spreadsheet formula prefixes.

## Update safeguards and recovery

Run authorizes a **new** automatic job; PROD additionally requires the confirmation popup, including for retries. The API binds confirmation to the host/configuration shown in the popup. Supabase records the confirming user ID, time and configuration hash before queueing production work. Cancelling a popup does not queue a job or change prices. Browser-supplied item IDs and update snapshots are never accepted. Configuration is hashed with the execution policy, template IDs, root, mappings, aliases, languages, timezone and preserve-blank policy. Configuration changes require a new upload.

Before each mutation the function rechecks the residence, Yardi ID, target path, template, latest language/version, locks, revision, and existing values. Changed content becomes a conflict; unrelated valid targets continue. Write intent is saved before sending an update; every write is read back. An interrupted/uncertain write is reconciled on Retry/resume: already-requested values are marked applied, unchanged snapshots can be retried, other values are conflicts. Already-applied rows are never requeued. Missing language versions remain skips even if removed after validation.

Actual locks remain issues with the owner in the Developers tab; empty `<r />` lock records are unlocked. Unknown/malformed lock metadata stops the job. Save and unlock through Sitecore, then upload a fresh run for corrected targets. Do not automatically release locks.

The standard Sitecore update operation has no atomic revision compare-and-set, so a simultaneous human edit between the pre-write read and mutation remains possible. Coordinate each import window with editors. There is no automatic rollback; previous values are retained for a separate restoration workflow.

There is **no publishing call**. These are authoring content changes in the selected environment, including PROD when selected and confirmed. Website publishing, promotion scheduling, cache revalidation and production support remain separate. A confirmation authorizes all eligible changes in that import; it is not a preview approval step.

Cancel is offered only between batches (or after a lease expires); writes already applied are retained. Retry resumes interrupted service work and preserves snapshots. Source validation/matching errors and conflicts require correction and a new upload.

## Source maintenance and validation

Canonical shared code is in `lib/sitecore-pricing/`; the deployed handler is `supabase/functions/sitecore-pricing/index.ts`. After editing canonical code, regenerate both CLI shared modules and the single-file Dashboard distribution with:

```powershell
python infrastructure/performance/deploy/package_sitecore_pricing.py
```

CLI alternative to the Dashboard: use the explicitly performance-scoped command `npm run supabase:performance -- functions deploy sitecore-pricing --no-verify-jwt` after linking that workdir to the performance project. Do not deploy it through the original chatbot workdir.

Tests and builds were not run, per repository instructions. App TypeScript and the packaged Edge distribution were checked separately. Focused lifecycle, lease, environment-isolation, production-confirmation and authorization tests are supplied for later execution. Hosted installation and live Sitecore behavior still require your deployment and a small DEV run.

References: [Supabase scheduled functions and Vault](https://supabase.com/docs/guides/functions/schedule-functions), [background task lifetimes](https://supabase.com/docs/guides/functions/background-tasks), [Edge limits](https://supabase.com/docs/guides/functions/limits).
