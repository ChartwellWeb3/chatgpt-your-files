# Chartwell AI visibility (GEO)

`/chartwell-geo` monitors saved OpenAI API answers to senior-living research questions: whether Chartwell appears, which other operators appear, and which websites are cited or consulted. It measures collected answers, not search demand, website traffic, conversions, or exactly what a person sees in ChatGPT.

Login and access levels come from the **original chatbot Supabase project**. GEO data and jobs live in the **performance Supabase project**. The browser calls authenticated Next.js APIs rather than querying the performance database directly.

## Tabs and scope

| Tab | Purpose and selection |
| --- | --- |
| Overview | Chartwell discovery cards, comparisons, weekly trend, topic/market breakdowns, weekly schedule controls, and branded factual validation. Benchmark, Toronto dates, topic, market, and language apply to both discovery and validation. |
| Questions | Browse by topic/market and view per-question Chartwell mention rate and share of brand mentions; add, edit, approve, test, collect, and select Monday questions. Library filters select questions; benchmark/dates select the answers used for their metrics. |
| Answers | Reporting history and batch progress; inspect evidence, retry failures, or cancel unfinished collections. Uses reporting filters and optional answer status. |
| Test history | Saved previews across all benchmarks and dates in this environment. Outside reporting filters and always excluded from statistics. |
| Mapping review | Unresolved residence/operator pairs across all dates and benchmarks in this environment. Supports both question types and both run purposes. |
| Competitors | Operator mention rates, share of mentions, and answer counts for completed reporting answers matching the selected filters and question type. |
| Sources | Cited/consulted websites and unique pages for completed reporting answers matching the selected filters and question type. |
| Opportunities | AI suggestions supported by at least three completed reporting answers matching the selected filters; investigate or dismiss them. |
| Guide | Nontechnical instructions, metric examples, scheduling, recovery, reviews, and access levels. Independent of reporting filters and benchmark selection; reading it starts no AI work. |

## Question library and collection

Questions have a topic, market, language (`en` or `fr`), brand-name classification, approval state, revision, and `schedule_included` flag. Blue **Without brand names** badges identify discovery questions; purple **With brand names** badges identify questions naming Chartwell or another operator. Questions and Answers both show these badges.

New and AI-suggested questions are drafts, labeled **Needs review** in the library. Levels 1–2 can approve or archive them. Editing wording or measurement tags requires approval again. Historical runs retain the wording, tags, and version captured when queued. Edits, archival, or removed approval before collection begins cancel obsolete pending work; analysis already underway uses the collected answer's saved snapshot.

| Action | Question set | Statistics |
| --- | --- | --- |
| Test | One saved draft or approved question | Never. Saved in Test history; no Test all action. |
| Run now | One approved question | Included only after collection and analysis succeed. |
| Run all approved questions | Every approved question in the environment, across all pages | Same reporting dataset as Run now and scheduled collection, after successful processing. |
| Monday collection | Approved questions checked **Include in Monday collection** | Same reporting dataset after successful processing. |

Run all confirms the benchmark, environment, and approved-question count before submission. Search, the visible page, and Monday checkboxes do not reduce its scope. Run now also ignores the Monday checkbox. A test stays **Test — excluded from statistics**, including after mapping verification.

Each new reporting run is another observation. Repeating one question increases its weight. Retrying a failed run retains its identity and selects one successful attempt rather than adding another observation. Previous manual pilot answers remain logical test history; previous scheduled answers remain reporting history. Existing opportunities supported by tests are retained outside reporting.

### Optional search-prompt import

Use [the atomic replacement import](../../infrastructure/performance/sql/20261110123000_geo_import_search_prompts_atomic.sql), rather than the earlier temporary-table version. It imports 92 English prompts with topics, markets, and question types; all eight “near me” prompts are excluded. New questions are drafts with Monday collection off. Existing matching questions, edits, and approvals are preserved. Select the intended environment in the script. This optional import starts no collection jobs or AI calls.

### Browse questions by topic or market

In **Questions → Browse by topic or market**, choose a topic, market, or both. Language, question brand type, search, and approval filters can further narrow the library. The server applies all filters before pagination; every matching question remains accessible across pages. Approval-button counts still describe the whole library, while the footer describes the filtered list. Clear question filters resets the library selection. Overview's topic/market breakdowns also offer **View questions**, opening the related group. These links preserve the selected benchmark and dates and show current library tags rather than reconstructing old historical groups.

Each question shows **Chartwell mention rate** and **Share of brand mentions** with the underlying answer/mention counts and metric-help dialogs. Select **Benchmark for questions** and the Toronto metrics dates; those also update the shared reporting benchmark/dates, and new collection uses that benchmark. Dates select metric observations, not which saved questions exist in the list. A benchmark is optional for browsing; metrics are unavailable until one is selected.

Only successful monitoring runs with a successful selected attempt, the exact question ID/current revision, and matching saved classification, language, topic, and market enter these calculations. Earlier versions remain in Answers but do not get attributed to a changed question. Tests and unresolved/failed/unfinished answers never enter either numerator or denominator. Branded rows are labeled as branded-question results, separately from Overview discovery metrics. Run all still captures every approved question regardless of topic/market/search filters.

For four successful answers with three Chartwell mentions and twelve total operator mentions, mention rate is **75%** and share of mentions is **25%**. Each operator counts once per answer. Zero eligible answers show dashes; zero detected brands show a dash for share of mentions. A completed answer with no Chartwell mention contributes a real zero to mention rate. `geo_question_metrics_page` filters and paginates in SQL, then aggregates only the displayed questions; the browser never downloads answer histories to calculate these cards. New successful runs refresh the question metrics using adaptive polling and completion invalidation.

Every question also has **View answers**, available to all three roles. It opens paginated reporting history for that question ID and current revision, with the same benchmark, dates, and tags as the cards. **Completed** is selected initially to match the metric observations. The answer-status selector can expose other processing states; tests remain separate. Open an individual saved answer for its evidence, choose **Back to questions**, or **Clear question filter** to return to general reporting history under the remaining filters. Question/revision filtering happens in the API/database before pagination; this navigation needs no further SQL update beyond the question-metrics installation.

## Metrics, help, and filters

- **Chartwell mention rate:** completed answers mentioning Chartwell divided by all completed answers in the selection. Positive, neutral, and negative mentions count. Repetition counts once per answer.
- **Share of brand mentions:** Chartwell's answer-level mentions divided by the sum of all detected operators' answer-level mentions. Several operators can appear in one answer. Multiple recognized residences of one operator count once under that operator.
- **Discovery scope:** main Overview cards, weekly trend, breakdowns, and comparisons always use questions **without brand names**, enforced on the server. Branded mention-rate cards have been removed; branded factual validation occupies that section instead.
- **Eligibility:** the run and selected attempt must succeed. Tests, queued/running, failed, cancelled, interrupted, and mapping-review answers are excluded from metric numerators and denominators. An unfinished answer never counts as an answer where Chartwell was absent.
- **Rank:** average-rank and top-3 analytics, including competitor columns, are currently hidden. Stored ranks and calculation fields remain. Only explicitly numbered recommendations establish rank; bullet order does not.
- **Time:** dates use America/Toronto. Weekly points start Monday and group by requested collection time. Gaps mean no eligible answers, rather than zero visibility. Comparisons use the preceding period of equal length. Differences in question mix and collection frequency affect interpretation.
- **Help:** question-mark buttons use the shared `InfoDialog` to explain calculations, examples, scope, and interpretation. They make no AI requests.

Reporting selects a benchmark and dates, with topic, market, and language under **Refine results**. Answers, Competitors, Sources, and Opportunities also offer **Without brand names**, **With brand names**, and **All question types**. Overview fixes the discovery/validation split. Test history and Mapping review ignore reporting filters. The QA/PROD badge comes from server configuration; request parameters cannot switch environments.

History counts matching records; a batch counts its complete captured question set. For example, 12 completed answers can produce 10 matching unbranded history rows when two questions were branded. Check question type, benchmark, dates, topic, market, language, and status before treating a difference as missing data. Page controls navigate any remaining matching rows.

## Weekly schedule, progress, and cancellation

An administrator enables one benchmark per environment for **Monday, 9:00 AM America/Toronto**, adjusting for daylight saving time. Controls show the next collection, worker connection, and last scheduled batch. Enabling starts at the next Monday slot without backfill. After downtime, only the latest missed slot within 24 hours is collected; older slots are skipped.

The question checkbox controls Monday participation separately from approval. Only approved, checked questions join scheduled batches. Unchecking also cancels a scheduled question still waiting to begin when claimed; collecting/analyzing work continues. **Schedule paused** stops new Monday batches. Already queued work, Run now, Run all, Test, and saved-analysis rechecks can continue while the dispatcher is active.

Batches show queued, collecting, analyzing, completed, failed, cancelled, and mapping-review counts. **Cancel collection** stops unfinished jobs, including mapping-review holds, and fences later worker writes. Completed answers remain in reporting. Cancelled batches disappear from the collection list, with their records preserved. They cannot resume through retry, mapping verification, or recheck. Future scheduled slots remain enabled until the schedule is paused. An already issued provider request may still complete and incur usage.

## Two review workflows

### Factual answer validation

**Overview → Answer validation** supports **completed branded reporting answers only**. Levels 1–2 can record **Correct**, **Partly correct**, **Incorrect**, or **Unable to verify**; all levels can view the result and history. Tests and unbranded answers cannot enter this workflow, including through direct API/SQL review requests. Earlier unbranded reviews remain preserved outside the current queue.

Verified verdicts require an expected correct answer, reference URL, and confirmation that the source was checked. Incorrect/partly correct verdicts also require severity and notes. Unable to verify requires an explanation; a reference and expected answer are optional. Care-level, service, or location misinformation should normally be High severity. Successive versions preserve reviewer IDs and timestamps; conflicting edits require reloading the saved review.

Verdicts preserve the AI answer and do not change discovery statistics. Factual correctness is independent of successful collection/analysis. The reviewer checks reference pages; the app does not fetch or automatically validate them.

### Brand ownership mapping review

An unsupported residence/operator relationship pauses the answer as **Needs review**, preserving the response, original extraction, exact supporting quotes, citations, and every unresolved pair. The whole answer stays outside reporting calculations until the mappings are resolved and evidence checks pass. No partial brand statistics are published.

All levels can inspect records. **Only administrators (level 1)** can verify or recheck mappings:

1. Open **Mapping review → Review mapping**, or an answer marked Needs mapping review.
2. In **Brand ownership verification**, inspect the residence, AI-proposed parent, quote, and saved sources. The proposed parent can be corrected.
3. Select the established operator under **Verified parent brand**, or **Add a verified parent brand…** and supply its name.
4. Under **Reference URL establishing this relationship**, paste a real official operator/community page or another reliable source explicitly establishing the relationship. `https://operator.example/community` is placeholder text, not a reference to submit.
5. Read that page, optionally add verification notes, check the confirmation box, and click **Verify relationship**. Leave the pair unverified if the relationship cannot be established.

Verification registers the exact observed residence name as an alias in the shared operator catalog. A name registered to a different operator cannot be reassigned silently. The original proposal, selected operator, administrator ID, timestamp, reference, and notes are immutable audit evidence. The operator catalog is shared; questions, runs, schedules, queues, and reporting remain scoped to QA/PROD.

Once every unresolved pair is verified, the original job revalidates its **saved provider analysis without another AI call or web search**. It counts only after passing remaining checks and completing as a monitoring run. Tests stay tests. Verifying an operator relationship is separate from judging all facts in the answer.

Older failed ownership analyses do not enter Mapping review automatically after installation. Redeploy the updated worker, open the failed answer as an admin, scroll below the answer/source panels, and click **Recheck saved analysis**. With a completed saved extraction, the worker either resolves it using known aliases or creates the pending pairs. This also rechecks a paused answer after a catalog update elsewhere. Invalid JSON, unsupported IDs, fabricated quotes, and invalid ranks still fail. A saved answer can exist despite failed analysis; Failed does not mean a human judged its facts incorrect.

## Backend responsibilities and APIs

```text
Original-project Auth → Next.js GEO API → Performance database queue
                                             ↑          ↓
                                   minute dispatcher → geo-worker
                                                        ↓
                                             saved answer and analysis
                                                        ↓
                                      completed answer or mapping review
```

SQL handles filtering, search, pagination, aggregates, comparisons, review selection, and queue rules. Next.js authenticates, checks permissions and input, chooses the environment, and returns compact data. The Edge Function collects answers, extracts/validates evidence, and processes background stages. React handles selection, forms, dialogs, formatting, and charts.

Overview uses one `geo_overview` SQL call for cards, comparisons, sorted breakdowns, and gap-filled weeks; share-of-mentions includes every detected brand in its denominator. Tab-specific responses avoid the full dashboard on Competitors, Sources, and Opportunities. Catalogs are cached separately from live status. Polling speeds up while collecting, slows while idle, and pauses intervals in hidden documents. Mutations refresh affected queries.

Normal evidence includes one full answer, metadata for other attempts, compact sources, the latest eligible factual review, and mapping evidence. Paused mapping answers expose their provisional extracted mentions. Earlier full answers, provider JSON, technical details, and paginated factual review history load on demand.

| Endpoint | Views/actions |
| --- | --- |
| GET `/api/geo` | `catalogs`, `live`, `overview`, `competitors`, `sources`, `questionMetrics` (paged library with metrics), legacy `questions`, `runs`, `tests`, `batches`, `schedule`, `validation`, `mappingReviews`, `evidence`, `attempt`, `raw`, `reviews`, `opportunities`. Legacy `bootstrap` and `dashboard` remain supported but are not polled by the page. |
| POST `/api/geo` | `saveQuestion`, `questionStatus`, `questionSchedule`, `reviewAnswer`, `schedule`, `retryBatch`, `cancelBatch`, `verifyMapping`, `recheckMapping`, `insightStatus`. Mapping verification/recheck and schedule changes are admin only. |
| POST `/api/geo/ai` | `runNow`, `runAll`, and `test` enqueue and return HTTP 202 with run/batch IDs and captured count. Legacy `run` means reporting Run now. `createBenchmark` (admin), `discover`, and `opportunities` retain website handlers. |

Run purpose (`monitoring` or `test`) is separate from its trigger. Purpose and question snapshots are immutable. Tests are excluded in both SQL and API queries; legacy `includeManual=true` cannot broaden reporting or opportunity evidence.

The worker accepts only `GEO_WORKER_SECRET` and uses server credentials, never browser sessions/public keys. Minute Cron dispatches work and checks due schedules. Database claims limit the project to two leased stages. Collection and extraction are separate provider calls with 80-second timeouts and three-minute leases. Every intermediate write verifies the lease; finalization is atomic. Scheduled slots and repeated request IDs are deduplicated.

Explicit temporary failures retry up to three times with delays. A valid saved answer can resume analysis without another collection/web search. Interrupted collection with an unknown provider outcome requires explicit review before retrying. **Retry failed** applies to reporting batches and can need a new provider request. The mapping-specific **Recheck saved analysis** reuses completed saved extraction without another provider call.

Benchmarks freeze independent GEO models, prompts, and measurement settings. Shared Deno-compatible validation is re-exported by `lib/geo/analysis.ts`; provider citation annotations supply sources. Partial outer Markdown emphasis is repaired only when the remaining quote matches the saved answer verbatim. This preserves ID, ownership, and rank checks.

## Permissions and configuration

| Capability | Admin (1) | Content team (2) | Basic (3) |
| --- | --- | --- | --- |
| View GEO results, evidence, reviews, and Guide | Yes | Yes | Yes |
| Manage questions/Monday checkboxes; Test, Run now, Run all | Yes | Yes | No |
| Retry/cancel reporting batches; save branded factual reviews; generate suggestions/opportunities | Yes | Yes | No |
| Verify/recheck mappings; create benchmarks; enable/pause schedules | Yes | No | No |

Original-project authorization precedes performance data access. Original Auth actor UUIDs are audit fields; performance SQL does not depend on copied profiles, cross-project Auth foreign keys, or original-user `auth.uid()` policies. Performance tables use RLS and private service access. No performance/worker credentials reach the browser.

Website configuration: existing original Auth variables plus `PERFORMANCE_SUPABASE_URL`, `PERFORMANCE_SUPABASE_SECRET_KEY`, `PERFORMANCE_ENVIRONMENT=qa|prod`, `OPENAI_API_KEY`, `OPENAI_GEO_MONITOR_MODEL`, and `OPENAI_GEO_ANALYSIS_MODEL`. GEO never falls back to the chatbot's `OPENAI_ANALYSIS_MODEL`.

The worker has its own `OPENAI_API_KEY`, `GEO_WORKER_SECRET`, and hosted performance-project built-ins. Model names come from benchmarks; no worker model secrets are needed. Website `.env.local` is not copied to Edge secrets. Vault holds the dispatcher URL and matching worker secret, not the OpenAI key.

## Installation and inspection

Follow [GEO-DEPLOYMENT.md](../../infrastructure/performance/GEO-DEPLOYMENT.md) for Dashboard/CLI setup, secrets, Cron, and manual acceptance. All GEO SQL targets the **performance project**. Supplied scripts are immutable: apply only missing prerequisites/new updates, rather than editing or rerunning old installation files as an upgrade.

For a fresh installation, the schema/update order is:

1. `geo-monitoring.sql`
2. `20261027190000_geo_dashboard_operations.sql`
3. `20261109120000_geo_queue.sql`
4. `20261109130000_geo_cancel_batches.sql`
5. `20261109150000_geo_answer_validation_and_question_schedule.sql`
6. `20261109160000_geo_branded_answer_validation.sql`
7. `20261109170000_geo_read_optimization.sql`
8. `20261110140000_geo_mapping_review_queue.sql`
9. `20261110150000_geo_question_metrics.sql`

Then deploy the current worker, configure Edge/Vault secrets, deploy the website, and activate the dispatcher with `20261109121000_geo_activate_cron.sql` **last**. Monday collection remains paused until an admin enables it. SQL alone cannot deploy TypeScript.

For an existing installation receiving mapping review: run the new mapping installation after its prerequisites, redeploy [the current Dashboard worker source](../../infrastructure/performance/deploy/geo-worker.dashboard.ts) or canonical sources, then deploy the website. No Cron reactivation or new secrets/models are required. Regenerate the Dashboard distribution after worker/shared-source changes using `python infrastructure/performance/deploy/package_geo_worker.py`; it combines text only.

Inspection files are **read-only queries, not installations**. A SQL Editor query's name does not create tables/views. Install successfully before inspecting:

| File under `infrastructure/performance/sql/` | Purpose |
| --- | --- |
| `20261109122000_geo_inspect.sql` | Schedules, queue, failures, heartbeat, Cron, and test/reporting isolation. |
| `20261109151000_geo_validation_inspect.sql` | Factual reviews and scheduled-question selection. |
| `20261109171000_geo_read_optimization_inspect.sql` | Compact reads and Overview comparisons. |
| **`20261110142000_geo_mapping_review_inspect_corrected.sql`** | Mapping queue, batch holds, verification audit, saved-analysis reuse, and exclusion checks. Replaces the earlier `...141000...` inspection script. Mentions join to runs through `geo_run_attempts`. |

The mapping installation is transactional. If it fails, resolve its first error before inspecting; schema changes roll back on failure. The corrected inspection needs no worker redeployment. The earlier one-residence Sunrise alias SQL is optional; administrator verification now supplies the general workflow.

For an existing installation adding question metrics, run the entire new [question metrics SQL](../../infrastructure/performance/sql/20261110150000_geo_question_metrics.sql) in the performance project, then deploy the website. It adds a private read RPC and a reporting index; no worker, Cron, model, or secret changes are required. All three user levels can view these metrics; management permissions remain unchanged.

## Limits and verification status

There is no spending cap, dollar-cost management, provider expansion, external question-research feed, or general alias-maintenance editor. Mapping verification can add verified aliases. API usage remains saved with evidence. Changing the library or collection frequency can change comparison cohorts.

No tests or builds were run for these changes, per the user's instruction. API/UI assertion source was updated during implementation but remains unexecuted. This README and Guide describe source behavior; they do not confirm hosted installation or deployment. Use the deployment guide's manual checks to validate the hosted setup.

The GEO type-safety review also runs the separate **no-emit TypeScript check**, `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`. This checks the application and assertion source without executing tests or producing a build. Required database results use `requiredData`; optional lookups and writes without returned rows retain nullable `checked` results. The response helper preserves heterogeneous PostgREST payload types rather than forcing different query results into one row shape. Check the worker and Dashboard distribution separately with Deno because the Next.js configuration excludes those entry points.
