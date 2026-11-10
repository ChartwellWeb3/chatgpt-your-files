# GEO worker deployment

This update runs GEO collection in the **performance Supabase project**. Login and user permissions remain in the original chatbot project. All new SQL is supplied as new files; do not rerun or edit earlier installation scripts if they are already installed.

## Question groups and per-question metrics update — November 10

For an existing GEO installation, run the entire new `sql/20261110150000_geo_question_metrics.sql` in the **performance SQL Editor**, then deploy the website. It requires the existing queue/reporting and schedule-checkbox schema. The file installs `geo_question_metrics_page` and a reporting-history index, with service-only permissions. **No worker redeployment, Cron change, new secrets, or model changes are needed.** Do not rerun earlier SQL files.

Questions now supports topic, market, language, brand type, approval, and search filters. All filters execute before pagination. Overview topic/market breakdowns have **View questions** links. These open the related current-library group with the selected benchmark/dates. Run all remains the full approved library, regardless of this selection.

**View answers** on each question opens reporting history filtered by that question ID/current revision, benchmark, dates, and tags, with Completed selected initially. It is available to all three roles; individual answers open the usual evidence dialog. Back to questions and Clear question filter provide return paths. This uses server-side filtering before pagination; tests stay in Test history. No extra database script or worker change is needed for this navigation.

Each row displays Chartwell mention rate and share of brand mentions for that exact question's **current revision and tags**, selected benchmark, and Toronto date range. Only successful monitoring runs with a successful selected attempt count. Tests, failures, interrupted/unfinished runs, and Needs review answers are excluded. Branded-question results are labeled and do not change Overview discovery scope. Zero eligible answers show dashes; share also shows a dash when there are no detected brands. The denominator includes every operator's answer-level mentions, once per operator per answer. SQL aggregates only the displayed page, without sending answer histories to the browser.

Manual checks for you to perform; no tests/builds were run:

- Browse a topic and a market separately, then together, across pages. Combine search/status/language/type and confirm the filtered total. Whole-library approval counts remain labeled separately.
- Open a topic/market from Overview and confirm the correct library filter, benchmark, and dates. Old historical groupings may differ if questions have since been edited.
- Compare per-question cards with saved evidence: three Chartwell mentions in four answers with twelve total operator mentions should show 75% mention rate and 25% share.
- Include a successful answer with no brands: it contributes to the answer denominator and no brand mentions. Failed, test, and mapping-review runs contribute neither. A zero-sample card must show a dash rather than 0%.
- Edit a question: earlier revisions must stay in Answers without entering current-version cards. Select a different benchmark or date range and check that metrics remain scoped.
- Confirm a Basic account can browse groups and metrics but cannot manage questions. Direct `view=questionMetrics` requests cannot switch the server environment or include tests with `includeManual=true`.
- Confirm Run all still queues every approved question and completed runs refresh question metrics. No AI call should be issued simply by browsing or changing metric filters.

## Brand mapping review update — November 10

For an existing installation, deploy in this order:

1. Run the **entire new file** `sql/20261110140000_geo_mapping_review_queue.sql` in the **performance project's SQL Editor**. The queue, cancellation, question schedule/validation, branded validation, and compact-read updates must already be installed. This file is transactional; run it once. Leave all earlier SQL files unchanged.
2. Redeploy `geo-worker` using the updated `deploy/geo-worker.dashboard.ts` (paste the complete file into the Dashboard editor), or deploy the canonical sources using the performance CLI command below. Retain the existing secrets and this function's disabled JWT verification setting.
3. Deploy the updated website. **No Cron reactivation, new secrets, models, or schedule changes are required.**

An unsupported residence/operator mapping now puts the answer in **Needs review**. Its original answer, provider response, extracted mentions, citations, and unresolved pairs remain saved. The whole answer is excluded from brand statistics, their denominators, source reporting, comparisons, and opportunities while paused. No partial brand counts are published.

Open **Mapping review → Review mapping** or an answer marked Needs review. All three levels can inspect evidence, but **only administrators (level 1)** can verify ownership. Select the correct existing parent brand, or add a verified parent brand, supply a reference URL, and confirm that you checked it. The app saves the administrator ID, timestamp, original proposed mapping, chosen brand, reference, and notes as an immutable audit record. It does not fetch the reference page or decide whether it establishes ownership; the administrator checks that evidence.

Verification adds the exact residence name as an alias in the shared operator catalog, so future extractions can recognize that relationship. A residence already registered to a different brand cannot be reassigned silently. Select the established owner, or resolve the catalog conflict before verifying. The verified parent may differ from the AI proposal; the original extraction is preserved.

After the final unresolved pair is verified, the existing job is queued to revalidate its **saved analysis**. It makes no new OpenAI request or web search. Reporting starts only after all remaining evidence checks pass and that same run completes. Tests stay tests and never enter reporting, even after verification. The queue spans all dates and benchmarks within the server-selected environment, independently of reporting filters.

For an **older failed ownership analysis**, an administrator can open the answer and choose **Recheck saved analysis**. It queues the saved provider extraction without recollecting or calling AI. Unknown ownership becomes Needs review; an existing verified catalog alias can let it complete. Invalid JSON, fabricated quotes, unsupported IDs, or invalid ranks still fail. Retry failed also recognizes the older parent-ownership error and reuses its saved completed analysis. Neither option promotes historical manual test runs into reporting. The earlier one-residence alias SQL is optional if you use this verification workflow instead.

Collection batches show how many answers need mapping review. Cancellation also stops these paused jobs and fences later writes; completed answers remain in reporting. Review evidence remains preserved, and cancelled jobs cannot be resumed by verification or recheck. Pausing a weekly schedule alone does not cancel them.

Use `sql/20261110142000_geo_mapping_review_inspect_corrected.sql` for **read-only** inspection. It replaces the earlier inspection script's incorrect direct join from mentions to runs; mentions link through `geo_run_attempts`. No installation or worker redeployment is needed for this inspection-only correction. Manual checks for you to perform:

- Collect or recheck an answer with an unknown ownership pair: confirm Needs review, the saved answer/mentions/sources, and exclusion from every reporting metric.
- Confirm all unresolved pairs appear, even when other mentions in that answer are already known. Verify one pair; it must remain paused until the others are resolved.
- Verify against a reference as an administrator, including correcting the proposed parent. Confirm the same run/attempt and provider analysis response complete without another AI call.
- Repeat with Test: it must remain in Test history and absent from reporting. Try `includeManual=true` too.
- Try direct verification/recheck API requests as levels 2 and 3: both must be rejected. A view-only user can inspect the evidence.
- Open two admin sessions: duplicate submissions must not duplicate aliases or resume cancelled/stale jobs. Conflicting catalog ownership must require resolution.
- Cancel a batch that has paused answers, then try verification/recheck: neither may restart it.
- Confirm QA/production run queues remain scoped correctly and ordinary successful answers continue to complete.

This update has not been deployed or run against Supabase. Test assertions were added as source only; no tests or builds were run.

## 1. Install the database update

In the performance project's SQL Editor, run the complete contents of:

`sql/20261109120000_geo_queue.sql`

Prerequisites: `geo-monitoring.sql` and `20261027190000_geo_dashboard_operations.sql` must already be installed in this project. The question seed file is optional. The new update is a one-time installation, wrapped in a transaction. It leaves schedules and the dispatcher paused. It does not copy data or install anything into the original chatbot project.

Existing manual answers stay saved as test history logically. Existing scheduled answers stay reporting history. Completed records are not rewritten or deleted. Reports may show fewer answers because the former manual pilot results no longer count. Existing opportunities supported by tests are hidden from reporting and retained in the database.

## 2. Deploy the Edge Function

Choose either option. Do not run the worker against the original chatbot project.

### Supabase Dashboard: paste one file

1. Open the performance project → **Edge Functions** → create a function named **geo-worker** using the editor.
2. Replace the entire function source with `deploy/geo-worker.dashboard.ts`. This distribution includes the shared types and evidence validation; no extra local imports are needed.
3. Disable **Verify JWT** / legacy JWT verification for **this function only**. It uses its own `GEO_WORKER_SECRET` check. A missing or incorrect secret receives HTTP 401.
4. Deploy the function. Its URL is `https://YOUR-PERFORMANCE-PROJECT.supabase.co/functions/v1/geo-worker`.

### CLI: deploy the canonical sources

From the repository root, link the independent performance workdir if necessary:

```powershell
npm run supabase:performance -- link --project-ref YOUR_PERFORMANCE_PROJECT_REF
npm run supabase:performance -- functions deploy geo-worker --no-verify-jwt
```

The sources live in `supabase/functions/geo-worker/index.ts` and `supabase/functions/_shared/` relative to this performance directory. The function-scoped JWT setting is also recorded in `supabase/config.toml`. No project-wide Auth change is needed.

The Dashboard distribution is a checked-in copy of the worker and shared sources. After changing those sources, regenerate it with:

```powershell
python infrastructure/performance/deploy/package_geo_worker.py
```

Packaging only combines source text. It does not build, test, deploy, or call OpenAI.

## 3. Add Edge Function secrets

In the performance project → **Edge Functions → Secrets**, add:

| Name | Value |
| --- | --- |
| `OPENAI_API_KEY` | Your existing OpenAI API key |
| `GEO_WORKER_SECRET` | A new randomly generated secret with at least 32 characters; use 64 hexadecimal characters |

The worker uses the hosted project's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not replace those with original-project credentials. Models and prompts come from each saved benchmark, so the worker does not need separate model environment variables. It accepts the existing v1 measurement settings, including required web search and the saved analysis schema version.

The website still needs its existing original Auth configuration, `PERFORMANCE_SUPABASE_URL`, `PERFORMANCE_SUPABASE_SECRET_KEY`, and `PERFORMANCE_ENVIRONMENT=qa` or `prod`. Website setup/discovery/opportunities also retain `OPENAI_API_KEY`, `OPENAI_GEO_MONITOR_MODEL`, and `OPENAI_GEO_ANALYSIS_MODEL`. Do not place secrets in browser variables or source files.

## 4. Add the two Vault secrets

In the performance project's **Vault** interface, create:

| Vault name | Value |
| --- | --- |
| `geo_project_url` | `https://YOUR-PERFORMANCE-PROJECT.supabase.co` |
| `geo_worker_secret` | Exactly the same value as the Edge Function's `GEO_WORKER_SECRET` |

Keep one secret with each name. Use the Vault UI so secret values do not need to be pasted into a shared SQL file. Rotations must update both the Edge secret and its matching Vault entry.

## 5. Deploy the website, then activate Cron

Deploy the updated website. Until activation, the page explains that the dispatcher is not ready.

Run the complete contents of `sql/20261109121000_geo_activate_cron.sql` in the performance SQL Editor. It enables `pg_cron` and `pg_net`, installs the minute dispatcher, and checks that Vault entries exist. If Supabase requests extension enablement first, enable **Cron / pg_cron** and **pg_net** in the project Dashboard and rerun this activation file.

This step starts queue processing, but **does not enable any question schedule**. With no queued work, the dispatcher sends one heartbeat invocation per minute and makes no OpenAI requests. New queued work normally starts within a minute. A worker invocation processes one collection or analysis stage; at most two stages are active across QA and production in this project.

Refresh the website after the first heartbeat, open **Overview → Weekly collection**, select the intended benchmark, and choose **Enable Monday schedule** as an admin. The first slot is the next Monday at 9 AM Toronto time. Only one benchmark per environment can be scheduled. Enabling a different benchmark replaces that environment's previous schedule. QA and production are enabled independently.

## Behaviour and recovery

- **Test** works on saved drafts and approved questions. Test history is separate from reporting and ignores reporting dates/filters. Tests never enter metrics, sources, comparisons, or opportunity evidence.
- **Run now** requires an approved question. **Run all approved questions** captures the full approved library across all pages for this environment and benchmark. Both count toward reporting once completed.
- A run retains its question snapshot and purpose. Changes to wording/tags or approval before collection starts cancel pending obsolete work. Analysis of an already collected answer finishes against the saved snapshot.
- Website submission returns HTTP 202 immediately. Queue work continues after the browser closes. Answer details, batch progress, and the dashboard poll saved state.
- Collection and analysis are separate stages. Each provider call has an 80-second timeout. Leases last three minutes. Only explicit temporary provider failures are retried automatically, up to three retries with delays. Interrupted analysis can resume from the saved answer. There is no spending cap or cost-management feature.
- A collection timeout/network interruption might have reached the provider. Such a run is marked failed and **needs review** rather than automatically collected again. Open its evidence, then explicitly choose **Retry failed** on its reporting batch if appropriate. Retries reuse a valid saved answer whenever available. Successful runs are unchanged, and successful retries select one attempt on the original run rather than adding another statistical observation.
- The Monday scheduler catches up only the latest missed slot within 24 hours. Older missed slots are skipped. Enabling a schedule does not backfill history.
- **Pause schedule** stops future scheduled batches, while queued jobs continue. To stop all processing, including tests and Run now, run:

```sql
select cron.unschedule('geo-dispatch-every-minute');
update public.geo_worker_runtime set dispatcher_enabled=false where id=true;
```

To resume the dispatcher, rerun only the activation file. Existing queued jobs are retained. Schedule enablement is separate.

## Inspection and manual acceptance

### Sunrise of Victoria ownership alias

If analysis names the parent **Sunrise Senior Living** while its exact supporting quote names **Sunrise of Victoria**, the catalog must establish that residence-to-parent relationship. `sql/20261110130000_geo_sunrise_victoria_alias.sql` registers that specific residence alias on the existing brand UUID supplied in the reported failure. The mapping was checked against the official community page linked in the SQL comments. Existing aliases and reporting history are preserved; a conflicting brand mapping aborts the update.

Run that new SQL file in the **performance** SQL Editor, then use **Retry failed** on the affected batch. The worker reloads aliases for every stage, so no worker or website redeployment is needed for this data correction. Complete saved answers resume analysis. This catalog update adds an explicit verified relationship; the quote, brand-ID, and ownership checks continue to apply. Test source covers acceptance after registering the alias and rejection without it; tests were not run.

### Partial Markdown evidence quote update

Redeploy **`geo-worker`** to the **performance project** with the updated canonical sources or the complete regenerated `deploy/geo-worker.dashboard.ts`. No SQL, benchmark, model, secrets, or Cron changes are needed. The queue worker applies the fix as soon as the function is redeployed.

The validator first accepts an exact supporting quote. If that fails, it removes only matching outer Markdown emphasis markers (`*`, `**`, `***`, and underscore equivalents), then requires the remaining phrase to occur verbatim in the original saved answer. It saves that exact source phrase. Words, case, punctuation, internal Markdown, brand ownership, IDs, and explicit numbered ranks retain their existing checks. Saved answers, raw extraction responses, and completed historical records are unchanged.

For example, a model quote ending `Amica Somerset House**` can be repaired when the original bold span continues through other residences. It is stored as the exact inner Amica phrase rather than rejecting the whole analysis for the misplaced closing marker. A changed or invented phrase still fails.

Future failures preserve a specific validation reason, such as “Supporting evidence quote was not found verbatim in the saved answer,” “Brand ID is not supported by the observed name,” or “Recommendation rank is not present in the evidence quote.” Invalid analysis JSON has its own error. Unexpected runtime errors retain a generic message; raw provider text is not copied into these error messages.

After deployment, open **Answers → Collection batches → Retry failed** for the affected batch. Runs with a complete saved answer resume analysis using that answer and its saved citations. This action includes other failed runs in the batch; failures without a reusable completed answer may need collection again. Successful runs remain unchanged. The existing failed error message updates when its run is retried; this code deployment does not rewrite old attempts automatically.

Regression test source covers the reported Amica case, emphasis wrappers, exact-quote preservation, rejected text changes, and retained ID/ownership/rank checks. Tests and builds were not run, and no hosted requests were made while preparing this update.

### Compact reads and adaptive refresh update

Run **only** `sql/20261109170000_geo_read_optimization.sql` in the **performance** SQL Editor after the 15:00 and 16:00 validation updates, then deploy the website. Previously supplied SQL files remain unchanged. No Edge Function, secrets, or Cron changes are needed.

The website now uses these authenticated reads:

| View | Work performed |
| --- | --- |
| `catalogs` | Topics, markets, brands, benchmark metadata, and model configuration; cached in the browser for five minutes without interval polling. |
| `live` | One SQL call for library counts, schedule flags, worker heartbeat, and monitoring/test activity. Access level is supplied by original-project authorization on every request. |
| `overview` | One SQL call for Chartwell metrics, previous-period differences, sorted topic/market breakdowns, gap-filled weekly points, and status counts. Always unbranded reporting data; the share-of-mentions denominator still includes all detected brands. |
| `competitors` | One overall brand-metrics call, with no Overview charts or source list. |
| `sources` | One source-summary call, returning only source rows. |
| `opportunities` | The paginated opportunity list and a filtered count of completed reporting answers; no full dashboard request. |
| `schedule` | The latest scheduled batch only. |

While work is active, live status, visible run history, and batch progress refresh every five seconds; visible reporting views refresh every fifteen seconds. Idle views refresh every sixty seconds. Interval polling pauses when the document is hidden. Returning to the page refreshes stale queries. Catalogs refresh on relevant metadata changes, explicit refresh, or a stale window-focus refresh. Normal edits invalidate only their affected queries: a schedule checkbox refreshes questions and live counts; a saved review refreshes validation and its review history. Reporting completion refreshes the reporting views; test completion refreshes tests.

Answer details return one full selected/latest answer and metadata for up to ten attempts. Previous answer text and source links load when **Load answer for attempt…** is selected. Provider JSON, usage, and raw source annotations load through **Load provider JSON**. Earlier human reviews load only when **Review history** is opened, with ten per page. Raw/evidence/attempt/review requests all recheck the original-project session and constrain the run to the website's environment. Review history remains limited to completed branded reporting answers.

Older `bootstrap` and `dashboard` API reads remain for compatibility; the updated page does not poll them. No shared server cache or precomputed reporting tables were introduced.

Use `sql/20261109171000_geo_read_optimization_inspect.sql` for read-only inspection and comparison with the existing metric function. Manual checks for you to perform:

- Keep the same benchmark, dates, topic, market, and language; confirm mention rate, rank, top 3, share of mentions, comparisons, and weekly gaps match the earlier definitions, including across Toronto DST.
- In browser Network, open each tab. Competitors, Sources, and Opportunities must not request `view=dashboard` or the Overview charts.
- Leave the page idle: catalogs should not repeat every fifteen seconds. Queue work and confirm faster progress updates, then hide the page and confirm interval polling stops.
- Toggle a question's Monday checkbox: questions/live data should refresh, without requesting sources or competitor metrics.
- Open an answer: attempt-history rows should contain no full response bodies; load a previous answer and provider JSON explicitly.
- Open a branded answer with several reviews: the normal evidence response should include only the current review; opening history should fetch its paginated records.
- Confirm tests remain excluded, QA/production are isolated, and level-three users retain read-only access.

No tests, builds, hosted SQL, or deployments were executed while preparing this update. Source parsing and whitespace review do not verify runtime speed; measure the changed queries in your environment.

### Branded-only answer validation update

Run `sql/20261109160000_geo_branded_answer_validation.sql` in the **performance** SQL Editor after the 15:00 answer-validation update, then deploy the website. No worker or Cron redeployment is required. The validation list and review form now support **questions with brand names only**; the question-type selector is removed. Legacy requests specifying unbranded/all cannot broaden the queue. Both the review RPC and insert trigger reject answers whose saved question snapshot is not branded. Existing unbranded reviews remain stored as history and are hidden from validation and answer details. Discovery reporting and scheduling are unchanged.

Manually confirm that an unbranded answer has no review form and cannot be reviewed through the API, that validation stays branded even with `questionKind=all`, and that a completed branded reporting answer can still be reviewed and its history reopened.

### Answer validation and question schedule selection update

After installing the queue and cancellation updates, run **only** `sql/20261109150000_geo_answer_validation_and_question_schedule.sql` in the **performance** project's SQL Editor, then deploy the updated website. Do not rerun earlier SQL. The existing Edge Function and Cron configuration continue to work; this update replaces their database enqueue/claim functions with the same signatures. It does not enable or pause a schedule.

Existing questions start checked to preserve the current Monday question set. In **Questions**, levels 1–2 can toggle **Include in Monday collection**. Only approved, checked questions join Monday batches. Unchecking also cancels a scheduled collection still waiting to begin when the worker next claims it. Work already collecting or analyzing continues. Run now, Run all, and Test ignore this checkbox; Run all continues to collect every approved question across all pages. Library approval and question revisions remain unchanged when toggling the checkbox.

**Overview → Answer validation** replaces the branded mention-rate cards. With the 16:00 restriction installed, it shows only branded reporting answers and has a review-status selector. Benchmark, dates, topic, market, and language come from the Overview filters. Open **Review answer**, read the full saved answer and citations, and record **Correct**, **Partly correct**, **Incorrect**, or **Unable to verify**. Verified verdicts require an expected answer, a reference URL, and confirmation that the reviewer checked that source. Issues also require severity and notes. Unable to verify requires an explanation. Care-level, service, or location misinformation should normally be High severity.

This is a human factual-review workflow. Reference URLs and expected statements are saved with the review; the app does not fetch or automatically validate reference pages. Reviews never rewrite the AI response or change discovery metrics. Only successful reporting answers can be reviewed, enforced by a database trigger and view. Tests remain excluded. All levels can read reviews; levels 1–2 can save them. Original-project reviewer IDs, timestamps, and successive review versions are preserved without copying Auth users. Concurrent edits return a conflict and let the reviewer reload the saved version before resubmitting.

Use `sql/20261109151000_geo_validation_inspect.sql` for read-only inspection. Manual checks for you to perform:

- Mark a branded reporting answer incorrect with a reference URL, expected answer, severity, and notes; reopen it and confirm the saved review.
- Update its verdict and confirm both versions remain in recent review history.
- Open the same unreviewed answer in two sessions; after one saves, the other must reload before replacing its review.
- Confirm tests and unfinished answers cannot be reviewed, including through direct API requests.
- Uncheck an approved question. The next scheduled batch must exclude it; Run now and Run all must still include it.
- Uncheck a question already waiting in a scheduled batch; it must be cancelled before collection begins. Already collecting/analyzing work continues.
- Confirm a level-three account can read but cannot change reviews or question schedule selection, and QA/production remain separate.

### Cancel collection update

If the queue is already installed, run **only** `sql/20261109130000_geo_cancel_batches.sql` in the performance SQL Editor and deploy the updated website. For a fresh installation, run it after the queue SQL. Do not rerun the queue installation or Cron activation for this update. The deployed worker needs no changes.

In **Answers → Collection batches**, levels 1–2 can choose **Cancel collection** on a batch with queued, collecting, or analyzing jobs. Confirm to stop its unfinished jobs. Completed answers and evidence stay in reporting. Previously failed jobs remain visible, but stopped batches cannot be retried; start a new collection if needed. Future Monday slots are unaffected—use **Pause schedule** to stop those too. Repeated cancellation requests are safe, and cancellation is scoped to the server-selected QA/production environment.

An OpenAI request already sent may finish and incur usage. Clearing the cancelled jobs' leases blocks subsequent response writes, analysis dispatch, and finalization. The confirmation explains this behaviour.

`sql/20261109122000_geo_inspect.sql` contains read-only queries for schedules, the worker heartbeat, batch progress, failure details, test/reporting separation, DST behaviour, and Cron/HTTP outcomes. Run individual queries; the Cron queries require activation first. Do not share Vault values or HTTP request headers in diagnostics.

Use the website to check that a Test leaves reporting unchanged, Run now contributes one completed answer, Run all includes the entire approved library, interrupted jobs preserve evidence, and scheduled collection fires once at the local Monday slot. Test both QA and production boundaries and a level-three account's read-only access. Supplying `includeManual=true` to an old API URL cannot include tests.

No tests, builds, hosted SQL, deployments, or paid OpenAI requests were run while preparing this update. The accompanying test source has been updated for the new contracts but remains unexecuted.

References: [Supabase Cron scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [Edge Function limits](https://supabase.com/docs/guides/functions/limits), [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search).

## Per-user section access

AI Visibility requires `profiles.feature_access.ai_visibility = true` in the original chatbot/Auth project. Admins always retain access. Install the original-project migration `supabase/migrations/20261110120000_add_profile_feature_access.sql` before deploying the feature switches; this requires no GEO/performance database update. Admins manage grants in `/team`. The role permissions described in this guide apply after section access is granted: levels 1–2 can manage questions and request AI operations; admin-only actions remain admin-only.
