# Chartwell website performance

The dashboard is available at **`/chartwell-website-performance`**. It reads stored Lighthouse lab measurements and deployment history from a separate website performance Supabase project. All signed-in application users can open the dashboard, subject to the existing email-verification flow. Login, profiles, and all chatbot data remain in the original project.

Each app deployment displays one environment from the server-only **`PERFORMANCE_ENVIRONMENT`** setting: **`qa`** on QA or **`prod`** on production. The environment is displayed as a fixed badge, with no dropdown. The default data selection is the **latest deployment** and the **latest measurement attempt for each device**. Mobile and desktop are handled independently. There is no fixture-data fallback in the dashboard.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `page.tsx` | Dynamic server route entry point. Reads the configured environment, renders its setup state if invalid, and passes the environment to the client dashboard. |
| `performance-dashboard.tsx` | Fixed environment badge, deployment/date filters, selected attempts, device score cards, page table, inline expansion, and tabs. |
| `performance-trend.tsx` | Shared score-history chart. Shows an overall page-score average in the overview and the individual page's score inside expanded details. |
| `performance-details.tsx` | Fetches one full page result on expansion. Shows aggregate values, the page-specific chart, opportunities, and individual samples. |
| `performance-commits.tsx` | Previous/current deployment identities, added/removed commits, message search, and expandable messages. |
| `performance-score.tsx` | Performance-specific score ring and score value, using the shared badge primitive. |
| `performance-format.ts` | Link validation and status formatting. Some comparison/consistency text helpers remain available for future use but are not rendered in the current UI. |
| [`../../lib/performance.ts`](../../lib/performance.ts) | Schema types, metric definitions, formatting, device-card aggregation, and commit normalization. |
| [`../../infrastructure/performance/sql/performance-trends.sql`](../../infrastructure/performance/sql/performance-trends.sql) | SQL Editor installation script for overall/page trend aggregation and measurement compatibility. |
| [`../../lib/performance-client.ts`](../../lib/performance-client.ts) | Browser fetch helper for `/api/performance`, including JSON and session/error handling. |
| [`../api/performance/route.ts`](../api/performance/route.ts) | Authenticated, read-only Supabase queries. |
| [`../utils/supabase/performance-server.ts`](../utils/supabase/performance-server.ts) | Server-only performance client and environment configuration, with separate credentials, no user session, and explicit setup errors. |

The UI reuses the project's existing cards, buttons, badges, pills, inputs, selects, tabs, and tables from `components/ui`. Styling uses the existing Tailwind theme. There is no dashboard CSS module or separate UI component system.

Navigation is configured in `app/Links/Links.tsx`; the route's navigation icon is registered in `app/layout.tsx`. Page and API access prefixes are listed in `app/const/userLevels.tsx` for all three user levels.

## What the dashboard shows

### Filters and deployment context

- **Environment:** a static QA or PROD badge from `PERFORMANCE_ENVIRONMENT`, with no environment dropdown. The API uses this server setting for deployment/history queries and ignores an `environment` URL parameter.
- **Deployment:** latest by default, or a deployment from the returned list.
- **Deployment dates:** optional start/end dates applied on the server to `source_finished_at`.
- **Selected deployment:** build number, branch, short commit SHA, source completion timestamp, environment, Azure deployment link, and deployed-site link when available.
- **Operational status:** deployment record exists, combined Lighthouse audit status, and combined ingestion status for the selected mobile/desktop attempts.

The date-filter label intentionally omits the timezone name. Its calendar boundaries still use **America/Toronto**, including daylight-saving changes. The end date includes the entire local calendar day. Displayed timestamps also use America/Toronto and include `ET`; the footer names the timezone.

“Recorded” means a deployment row exists. Audit status describes collection completion, while ingestion status describes database ingestion. These are separate concepts from the performance score.

### Mobile and desktop cards

Each card contains:

- The device name and its selected measurement attempt.
- A score ring showing the average of eligible page scores for that attempt.
- Audit and ingestion status badges.
- A monitoring-build link and operational error message when supplied.
- A short measurement UUID and a note explaining the average's exclusions.

The attempt selector permits inspection of older attempts from the same deployment. The cards intentionally omit the coverage, regression, failed-page, and inconsistent-page counters and the “pages measured” caption.

### Performance over time

The chart currently plots **Score / 100 only**. LCP, TBT, CLS, FCP, and Speed Index remain available in the page table and samples, but are not selectable chart metrics.

The overview chart shows the **overall average of eligible page scores for each deployment**. It has mobile/desktop controls and no page picker. An “All measured pages” badge identifies its scope. A chart inside expanded page details stays fixed to that page's identity, locale, and device, showing its individual score. Both reuse the same component and fetch calculated points from Supabase through the authenticated API. Each chart also offers:

- A reference-profile selector. Supabase compares the underlying settings instead of requiring identical full fingerprints.
- A latest trusted value and a count of trusted points/gaps.
- Hover details with build number, score, and timestamp. Overall averages also show how many page scores contributed.
- **View values**, an optional table explaining included points and gaps.
- A visible explanation when deployments are excluded.

Dates on the chart come from deployment completion, falling back to deployment creation when necessary. A deployment contributes at most one point for the selected device. For the currently selected deployment, the explicitly selected attempt is used; for other deployments, the newest attempt is used. Reruns do not create additional deployment points.

The “latest trusted point” may belong to an earlier deployment if the newest measurement is incomplete or unsuitable. It is not substituted into the current deployment's page score.

The overview labels its value **Average score / 100** and its summary **latest trusted average**. The optional values table includes the number of eligible pages out of available page records for each evaluated attempt. Missing/failed/profile-mismatched attempts remain gaps. The contributing pages can vary between deployments; the chart states this rather than implying a fixed page cohort.

### Page measurements

The table shows these columns:

| Column | Meaning |
| --- | --- |
| Page | Page name, path, and locale. Opens details immediately below that row. |
| Device | Mobile or desktop for the selected attempt. |
| Score | Stored Lighthouse performance score, plus a stored score change in points when eligible and available. |
| LCP | Largest Contentful Paint: time until the largest visible content is rendered. |
| TBT | Total Blocking Time: accumulated blocking portions of long main-thread tasks during loading. |
| CLS | Cumulative Layout Shift: unexpected visual movement, expressed without a time unit. |
| FCP | First Contentful Paint: time until the first content is rendered. |
| Speed Index | How quickly visible content fills in during page loading. |

Search matches the page name, path, and locale. Search, device filtering, ascending/descending metric sorting, total counts, and pagination run in Supabase through `performance_page_results_page`. Missing metrics sort last in both directions, with stable identity tie-breakers. The table fetches **8 rows per page** and defaults to the lowest scores first. Search is debounced by 250 ms and requests are cancellable. SQL clamps out-of-range page numbers after data changes.

Only rows from the selected mobile/desktop attempts are shown. Full results are fetched only when a row is expanded. Sample-consistency and comparison columns, their popovers, and the result-status filter are intentionally hidden.

### Expanded page details

Details appear in a table row directly beneath the selected page and contain:

1. Page identity and individual-sample count.
2. Operational errors, when present.
3. The six aggregate metric values.
4. The page-specific score-history chart.
5. Full-width optimization opportunities with estimated time and byte savings.
6. Individual Lighthouse samples, timestamps, and all six metrics.

There are no metric ranges, spread bars, sample-consistency banners, comparison badges, baseline-comparison panels, or baseline-identifier disclosures. The supplied representative-run reference is not displayed or interpreted as an array index.

Opportunity savings come directly from the report. They are estimates and can overlap; the dashboard does not add them into a guaranteed total saving.

### Deployment changes

The **Deployment changes** tab shows the previous and current source deployment, repository name, deployment-history status, relation, and Azure comparison link. This is source-code history, separate from the hidden Lighthouse baseline comparison.

Commits are assembled from both normalized `performance_deployment_commits` rows and embedded `deployment_changes.commits` / `removedCommits`. Entries are deduplicated by SHA within each direction; normalized records take precedence. The UI shows:

- Added commits and, for rollback/divergence when relevant, removed commits separately.
- Short SHA, author, date, full message expansion, and Azure commit link.
- Search across the complete message, author, and SHA.
- Local pagination at **6 commits per page**.

An unavailable history is explicitly distinguished from a confirmed empty range. If the normalized commit table cannot be read, embedded deployment changes can still supply the history. Commit history is displayed once per deployment rather than duplicated for mobile and desktop.

## Calculations and data quality

### Page values and formatting

The table uses the typed scalar columns when they contain finite numbers, falling back to the matching `aggregate.metrics` value. Expanded details use the full result's `aggregate.metrics`; individual samples use their own `metrics` objects. The dashboard does not recompute the collector's aggregation or assume it is an arithmetic mean.

| Display | Formatting |
| --- | --- |
| Score | Rounded to an integer out of 100. |
| Score change | Stored absolute delta, up to one decimal, with `pt`; not a percentage. |
| Timings | Milliseconds below 1,000 ms; seconds with two decimals at or above 1,000 ms. |
| CLS | Unitless, three decimal places. |
| Bytes | B, KB, or MB using 1,024-based conversion. |
| Missing/invalid values | `—`; never silently converted to zero. |

Zero remains a valid measurement. Scores of 90–100, 50–89, and 0–49 use the existing green, amber, and red score treatments. A low score is distinct from a failed audit.

The table displays measurements only when the page is complete, ingestion is ready, and the selected run is not failed. Stored score deltas are displayed only when sample consistency is explicitly valid. Missing stored deltas are not reconstructed from arbitrary historical points.

### Device average

`performance_run_summaries()` averages only pages that:

- Belong to the selected attempt.
- Have page status `complete`.
- Have a finite score.
- Are explicitly marked non-noisy/consistent.
- Belong to a run with ready ingestion that is not failed.

A partial run can therefore contribute its eligible completed pages to this average. The average is `null` when there are no eligible pages, and the ring shows `—`. Mobile and desktop averages are never combined. Summaries use every stored page for the requested attempts; downloading or filtering the table does not change the ring. The same RPC computes total, measured, included, noisy, failed, and regression counts.

### Trusted history

`performance_page_trend()` and `performance_overall_trend()` run in the performance database. Both require a complete run, ready ingestion, explicitly consistent samples, and comparable measurement settings. Page identity includes ID, path, locale, and available Sitecore site/item identity. The API supplies its configured environment, and SQL verifies that reference/selected attempts belong to that environment and device.

Compatibility includes the profile name, schema version, mode, device profile, full measurement configuration, authentication configuration, and toolchain. Only the Node minor/patch version is normalized away; its major version is retained. Lighthouse, Chromium, throttling, sampling, and other toolchain/settings changes remain distinct. Incomplete summary metadata falls back to an exact nonempty fingerprint; unknown settings are never assumed compatible. This avoids gaps caused solely by a collector's Node update, such as `v24.11.1` to `v24.22.1`.

The overall RPC calculates an unweighted arithmetic mean of eligible page scores directly from the stored rows for one attempt. Scalar scores take precedence, with a numeric JSON aggregate fallback. Scores must be in 0–100; zero is valid. There is no browser history-row limit or duplicate downloaded history to affect this average. The page RPC uses the same eligibility rules for one matching page. Neither combines devices, attempts, or deployments. A run with no eligible pages produces a gap. Contributing pages can vary across deployments; there is no fixed-cohort claim.

Device cards can show eligible pages from a partial run; both history charts intentionally require a complete run. A completed selected attempt's overall average uses the same page eligibility and arithmetic as its device card.

An unsuccessful latest attempt does not fall back to an older successful attempt for the same deployment. Ineligible measurements produce gaps; the chart does not connect through them. Hiding consistency labels does not remove these quality checks.

The collector's comparison classification, thresholds, reasons, and baseline IDs remain stored data. This dashboard does not recreate that classification algorithm.

## Data flow and API

The browser uses TanStack React Query and `/api/performance`. Each request first verifies the user's session using the original project's Supabase SSR client, then reads the new project using a separate server-only client. The browser receives the same dashboard response format and no performance credentials. The four data sources in the new project are:

| Table | Purpose |
| --- | --- |
| `public.performance_deployments` | One deployment shared by its device measurements and source changes. |
| `public.performance_runs` | One UUID per device/attempt, with audit, ingestion, profile, and monitoring metadata. |
| `public.performance_page_results` | Per-page metric columns and the complete `result` JSON. |
| `public.performance_deployment_commits` | Normalized added/removed commits. |

### Overview request

`GET /api/performance?deploymentId=...&from=YYYY-MM-DD&to=YYYY-MM-DD`

1. Verify the current Supabase user against the original project, read `PERFORMANCE_ENVIRONMENT`, and initialize the separate performance client.
2. Validate optional UUID and dates.
3. Fetch deployments for the configured environment, newest completion first, then creation time.
4. Fetch measurement attempts for the selected deployment, newest creation first.
5. Call `performance_run_summaries` for those attempts; return compact numeric summaries rather than downloading their page rows.
6. Fetch deployment commits and historical run metadata.
7. Return historical run metadata for the reference-profile selector. `pages` and `historyPages` remain empty arrays for response compatibility; charts and the paginated table request calculated data separately.

The overview does not fetch every run's full `summary` or every page's full `result` JSON. Dates filter source completion; rows with no source completion date are excluded when a date boundary is applied.

### Trend request

`GET /api/performance?view=trend&device=mobile&deploymentIds=UUID,UUID&referenceRunId=UUID&selectedRunId=UUID`

Add `pageId=...` for the expanded page chart. After original-project authentication and input validation, the API calls `performance_overall_trend` or `performance_page_trend` in the performance project. The browser receives `{ points }`, with one value or explicit gap reason per deployment. The deployment list comes from the date-filtered overview and is limited to 100 distinct UUIDs; SQL enforces the configured environment again. The page target's path, locale, and Sitecore identity are read in SQL from the selected attempt rather than supplied by the browser. Missing SQL functions return the private setup error `PERFORMANCE_FUNCTIONS_NOT_INSTALLED`.

### Page-table request

`GET /api/performance?view=pages&runIds=UUID,UUID&device=all&search=...&sort=score&direction=asc&page=0`

The API authenticates with the original project, validates at most two attempt UUIDs and an allowlist of metrics/devices/directions, then calls `performance_page_results_page` with the configured environment and a page size of eight. SQL returns `{ pages, total, page, pageSize }`. It resolves scalar/JSON metric fallbacks, excludes unavailable metrics from display, and includes a stored `score_delta` only when the page/run/ingestion/consistency rules permit it. It does not recompute the collector's baseline comparison. Search is a literal case-insensitive substring, including `%` and `_`; SQL is never composed from browser input. The response omits full result JSON and unused aggregate, insight, comparison, and identity payloads.

### Page-detail request

`GET /api/performance?view=page&runId=...&pageId=...&path=...&locale=...`

This fetches exactly one full stored page result for the selected run, page ID, path, and locale. Empty locale is queried as database `NULL`. No report files or Storage objects are downloaded.

### Summary request, available but not used by the current UI

`GET /api/performance?view=summary&runId=...`

The authenticated endpoint still supports explicit inspection of one stored summary. It returns an allowlist of top-level sections covering mode, status, profile, environment, device, measurement/build identifiers, timestamps, deployment, toolchain, measurement settings, selected pages, authentication mode, and storage metadata. Duplicated `pages` and `deploymentChanges` are omitted from its response. The current dashboard has no Run summary tab and does not issue this request.

### Caching and limits

- Overview query key: environment, selected deployment, and dates.
- Overview stale time: **30 seconds**; automatic window-focus refetch is disabled.
- Expanded page-result stale time: **60 seconds**, keyed by run/page/path/locale.
- Trend query key: deployment IDs, device, reference run, selected run, and optional page ID; stale time **30 seconds**, no automatic focus refetch.
- Refresh reloads the overview and invalidates active trend queries; it does not invalidate every cached page detail.
- Browser fetches and API responses use `no-store`; authenticated responses are private.
- Maximum **100 deployments**, **100 attempts for the selected deployment**, and **1,000 normalized commit rows** per overview request. Page rows are fetched separately, eight at a time, without the old 1,000-row cap on counts/averages.
- The profile selector uses up to **500 run metadata rows**. Trend SQL evaluates all stored page rows for the chosen attempts across the returned deployments, independently of that selector's limit.
- Query-limit or partial-history notices are returned when limits are reached. These are bounded data windows, not unlimited server pagination; narrow the dates to inspect another window.

## Available information intentionally not displayed

Hidden UI is presentation scope, not an authorization boundary. Some hidden fields are still returned by the authenticated API or used in calculations; others are only available in the database or the explicit summary response.

| Information | Where it is available | Current treatment |
| --- | --- | --- |
| Coverage, regression, failed-page, and inconsistent-page counts | Returned page records and `runSummary()` | Can be derived, but not rendered in device cards. |
| Sample consistency / noisy flags | `noisy`, `result.aggregate.noisy` | Used to exclude untrusted averages, deltas, and trend points; columns and warning banners are hidden. |
| Lighthouse comparison classifications and reasons | `result.comparison` and overview projection | No comparison column, badge, popover, status filter, or detail panel. |
| Baseline measurement/deployment IDs and `firstBaseline` | `result.comparison` | Retained but not shown. Stored score deltas can still appear next to page scores when eligible. |
| Timing/CLS comparison deltas | `result.comparison.metrics` | Available when ingestion supplies them, but not rendered. |
| Per-metric minimum/maximum ranges | `result.aggregate.range` | Not shown; there are no range labels or green spread bars. |
| Timing/CLS history | Stored historical page metric columns | The trend RPCs currently return Score / 100 only. |
| Representative-run reference | `result.representativeRun` | Not displayed or mapped to a sample index. |
| Sitecore identity fields and original page URL | `result.identity`, `result.url` | Identity supports grouping; raw site/item IDs and page-result URL are not shown. The deployment's site link remains visible. |
| Sample-level opportunities | `result.runs[].insights` | Stored in the fetched result; the opportunity list displays page-level `result.insights` only. |
| HTML/JSON report-relative paths | `result.runs[].htmlPath`, `jsonPath` and other report-relative fields | Not shown or treated as public URLs. |
| Run summary, sampling count, device/network settings, thresholds, variability configuration, toolchain versions, selected page IDs, authentication/storage modes | `performance_runs.summary`; explicit summary API | Available on demand; no summary tab, raw JSON viewer, or configuration panel. |
| Artifact name | `performance_runs.report_artifact_name`, selected by the API | Not rendered. Monitoring-build links remain visible. |
| Report provider/bucket/object path | Database-only run schema, when applied | Not selected or used by the dashboard. No Supabase Storage report fetching. |
| Azure project/repository/pipeline/source-build IDs and other ingestion metadata | Deployment schema and embedded deployment changes | Not all scalar IDs are selected by the overview; visible build identities/links come from the selected columns and deployment-change objects. |
| Full internal deployment and measurement UUIDs | API rows and summary | Used for queries and grouping. The device footer shows only a short attempt UUID. |
| Explicit timezone text in the date-filter label | Fixed timezone implementation | The label is hidden there; Toronto date boundaries, timestamp `ET` suffixes, and footer explanation remain. |

The Full Lighthouse reports section, report download controls, raw JSON views, numeric ranges/bars, and Run summary tab are deliberately absent. Collection/deployment pipelines, ingestion functions, chatbot tables, and Storage infrastructure are outside this route's scope.

## Authentication, errors, and empty states

The route and `/api/performance` are permitted for all existing user levels. Every request verifies a real user in the original project with its cookie-based server client before creating the performance client. This also applies to the page-detail and summary endpoints.

Performance queries use `PERFORMANCE_SUPABASE_URL` and `PERFORMANCE_SUPABASE_SECRET_KEY` on the server. A new `sb_secret_...` key is recommended; a legacy `service_role` key also works. This client bypasses RLS, so the API's original-project session check is the access boundary. It has no persisted session, token refresh, browser URL detection, or viewer cookies/access token. Database fetches use `no-store`. The dashboard remains read-only even though the server key has elevated privileges.

`PERFORMANCE_ENVIRONMENT` is required and accepts `qa` or `prod` (trimmed and normalized to lowercase). The page reads it on the server at request time and passes only this non-secret value to the dashboard. Missing/invalid values display an environment setup state; the API returns the same private configuration error described below. Set it per app deployment and restart/redeploy after changing the environment. It must match stored deployment environment values and does not change the database URL/key or convert existing DEV data. The environment filter is data selection; hidden controls are not an additional authorization boundary for signed-in users.

Missing/invalid environment configuration, missing credentials, an invalid performance URL, or a performance URL using the original project's origin returns a private `503` response with `kind: "configuration"` and `code: "PERFORMANCE_NOT_CONFIGURED"`. Credentials are read at request time so unrelated pages keep working before the new project is configured. There is no fallback to performance tables in the original project, and no second login or copied profiles are required.

The independent CLI configuration and migration/function folders are under `infrastructure/performance/`. See the [project setup README](../../infrastructure/performance/README.md). Run the additive [trend SQL](../../infrastructure/performance/sql/performance-trends.sql) in the existing performance database before deploying this chart update. It installs functions only; it does not create/copy the four existing tables or redirect the collector. A complete initial schema migration and historical data transfer remain separate work.

Missing schema or permissions produce an error state rather than preview measurements. Unavailable historical queries can leave the selected deployment visible with an availability notice. An unreadable normalized commit table can fall back to embedded deployment changes. No visible deployment rows produce an honest empty state, including QA/PROD before ingestion. Missing device measurements, page results, detailed JSON, insights, and trusted chart points each have explicit empty states.

The dashboard is a read-only consumer of the shared schema. It does not apply migrations, grant access, ingest CI data, change collection settings, or verify external Azure artifact availability.
