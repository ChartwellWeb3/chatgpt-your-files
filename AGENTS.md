# Chartwell Manager — AGENTS.md

## Project overview

**Chartwell Manager** is a Next.js 16 + Supabase admin console for managing Chartwell Retirement Residences chatbot content and reviewing chatbot analytics. It uses React 19, TypeScript, Tailwind CSS, shadcn/ui components, and Vitest for testing.

## Commands

```bash
npm run dev           # Start Next.js dev server
npm run build         # Production build
npm run start         # Run production server
npm test              # Run full test suite (vitest run)
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with V8 coverage (output: coverage/index.html)
npm run test:ui       # Open Vitest interactive UI (http://localhost:51204)
npm run gen:types     # Regenerate Supabase TypeScript types into supabase/functions/_lib/database.ts
npm run gen:types:performance # Generate types from the separate local performance database after its schema exists
npm run supabase:chatbot -- <command>     # CLI for the original project (workdir: .)
npm run supabase:performance -- <command> # CLI for the new project (workdir: infrastructure/performance)
```

## Architecture

### Tech stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5.9
- **Backend/DB**: Supabase (Auth, PostgreSQL, Storage, Edge Functions)
- **Styling**: Tailwind CSS 3, shadcn/ui (Radix UI primitives)
- **Data fetching**: TanStack React Query v5
- **Charts**: Recharts
- **AI**: OpenAI API (via `OPENAI_ANALYSIS_MODEL` env, default `gpt-5.6-luna`)
- **Testing**: Vitest 4, jsdom, @testing-library/react

### Directory layout
```
app/                          # Next.js App Router pages and API routes
  api/                        # API route handlers
    analytics/                # Analytics data endpoints
    performance/              # Website performance API; authenticates against the original project
    chat/                     # Prompt testing and analyzer testing
    sitecore/                 # Sitecore residence selector integration
  auth/callback/              # Supabase auth code exchange
  chat-bot-analytics/         # Analytics pages and section components
  chartwell-website-performance/ # Lighthouse dashboard, page trends, deployment changes
  chatbot-content-management/ # Document/residence management
  chatbot-prompt-testing/     # Prompt testing UI
  const/userLevels.tsx        # Access level definitions and allowed route prefixes
  helpers/                    # Shared helpers (fmtDate, etc.)
  hooks/                      # Custom React hooks
  login/                      # Login page and server actions
  team/                       # Team management page
  types/types.ts              # Shared TypeScript types
  utils/supabase/             # Original auth/chatbot clients + performance-server.ts for the new project
components/                   # Shared UI components
  NavLink/                    # Navigation components
  LoginForm/
  LogoutButton/
  ui/                         # shadcn/ui primitives
lib/                          # Shared library code (providers, utils, chatbot prompts)
supabase/                     # ORIGINAL project: Auth, chatbot data/content, chatbot analytics
  functions/                  # Deno Edge Functions
    analyze-conversations/    # AI conversation analysis job
    conversation-durations/   # Duration computation job
    embed/                    # Embedding generation
    process/                  # Document processing pipeline
    search-vector/            # Vector search
    _lib/                     # Shared library (database types, markdown parser)
  migrations/                 # SQL migration files (timestamped)
infrastructure/performance/   # NEW project: website performance data only
  README.md                   # Setup, project ownership, CLI and cutover instructions
  supabase/
    config.toml               # Independent local configuration and ports
    migrations/               # Reserved for performance migrations; no SQL created yet
    functions/                # Reserved for future performance ingestion functions
tests/                        # Vitest test files mirroring app/ structure
```

### Path alias
`@` maps to the project root (configured in `vitest.config.ts` and `tsconfig.json`).

## Two Supabase projects

The same Next.js application uses two separate Supabase projects:

| Project | Owns | Clients and configuration |
| --- | --- | --- |
| Original chatbot project | Login, Auth users, profiles/access levels, all chatbot data and analytics, residences, documents, Storage, existing chatbot jobs | `app/utils/supabase/client.ts`, `server.ts`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`; CLI root `supabase/` |
| New website performance project | `performance_deployments`, `performance_runs`, `performance_page_results`, `performance_deployment_commits`, future performance ingestion | Server-only `app/utils/supabase/performance-server.ts`, `PERFORMANCE_SUPABASE_URL`, `PERFORMANCE_SUPABASE_SECRET_KEY`; CLI root `infrastructure/performance/supabase/` |

- Keep the existing public Supabase environment variables pointing to the original project. All chatbot analytics remain there.
- `/api/performance` must verify the user's session with the original cookie-based server client before creating or querying the performance client. All signed-in application users may view performance.
- The performance client uses a server secret, bypasses RLS, and never receives the viewer's cookies or access token. Authorization belongs in the API. Never import this client into browser code, prefix its secret with `NEXT_PUBLIC_`, or return its credentials to the browser.
- Missing performance configuration returns a private `503` setup error. The performance client must never fall back to the original project; using the same project origin is rejected.
- Users and profiles do not need to be copied to the new project. Future performance SQL must not depend on profiles, `auth.uid()` policies for original-project users, or foreign keys into the original database.
- Reuse the existing dashboard components and `/api/performance` response format. Browser code fetches the API rather than querying the new project directly.
- The main Performance over time chart shows the overall average of eligible page scores per deployment, with separate mobile/desktop views and no page picker. Both charts fetch calculated points through `/api/performance?view=trend`, calling `performance_overall_trend` or `performance_page_trend` in the performance project. SQL requires complete audits, ready ingestion, consistent pages, and comparable measurement settings. Node minor/patch updates within one major version are compatible; browser/Lighthouse/settings changes remain separate. Both use the same chart component and one attempt per deployment; do not mix reruns or devices into an average. The SQL Editor installation script is `infrastructure/performance/sql/performance-trends.sql`; full initial schema/migration capture remains separate.
- Each app deployment has one website performance environment, configured with the server-only `PERFORMANCE_ENVIRONMENT` variable (`qa` or `prod`). `getPerformanceEnvironment()` in `performance-server.ts` supplies the server-rendered dashboard prop and the API's deployment/history filter. The UI shows a static badge; there is no environment dropdown. The API ignores a request's `environment` parameter. Missing/invalid values return a setup state instead of defaulting to DEV.
- The new project's migrations/functions folders are scaffolding only. No performance migration, data copy, or ingestion function has been created or deployed. Inspect the actual performance schema before creating its initial migration.
- See `infrastructure/performance/README.md` for setup and the remaining cutover work. The user creates the hosted project and configures credentials.

## Access levels

Defined in [app/const/userLevels.tsx](app/const/userLevels.tsx). Access is controlled by `profiles.level` in Supabase.

| Level | Role | Access |
|-------|------|--------|
| 1 | Admin | Full access, team management, delete visitor data, all API routes |
| 2 | Content Team | Content management + analytics + prompt testing |
| 3 | Basic | Analytics, website performance, and team pages only |

Website performance and `/api/performance` are allowed for all three user levels.

## Key database tables

- `profiles` — user profiles with `level` (access control)
- `visitors` — anonymous chatbot users
- `chat_sessions` — per-page chat sessions with `page_url`, `residence_custom_id`, `lang`
- `chat_messages` — individual messages (`role`: user/assistant/system)
- `chat_message_sources` — document sections cited by assistant messages
- `visitor_forms` — form submissions by visitors
- `residences` — residence records with `custom_id` (lowercase slug used as storage/search scope)
- `documents` — uploaded markdown files linked to residences
- `document_sections` — parsed sections with embeddings for vector search
- `chat_visitor_analyses` — AI-generated conversation analysis results
- `chat_visitor_durations` — visitor-level duration records
- `chat_session_durations` — session-level duration records
- `chat_common_words` — word frequency data per date range
- `chat_monthly_insights` — monthly aggregated analytics

Key views:
- `documents_with_storage_path` — joins documents to storage paths and residence metadata

## Supabase Edge Functions

Existing chatbot functions live in the original project's `supabase/functions/` and run as Deno processes. Future performance functions belong in `infrastructure/performance/supabase/functions/` and must target the new project:

| Function | Purpose |
|----------|---------|
| `process` | Downloads uploaded document, splits markdown into sections, inserts `document_sections` |
| `embed` | Generates embeddings for rows missing them |
| `search-vector` | Generates query embedding and calls `match_document_sections_public` |
| `analyze-conversations` | AI analysis job: fetches unanalyzed visitors, calls OpenAI, stores results in `chat_visitor_analyses` |
| `conversation-durations` | Computes per-visitor and per-session duration metrics |

The analyzer uses `OPENAI_ANALYSIS_MODEL` env var (default `gpt-5.6-luna`) and stores results with `prompt_version: "v1"`. The analyzer prompt is defined in `lib/chatbot/analyzerPrompt.ts` and reused in both the edge function and the analytics UI.

## Environment variables

Copy `.env.local.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_URL=              # postgresql://USER:PASSWORD@HOST:PORT/DB
PERFORMANCE_SUPABASE_URL=     # NEW project URL; server only
PERFORMANCE_SUPABASE_SECRET_KEY= # NEW project sb_secret_... key; server only (legacy service_role supported)
PERFORMANCE_ENVIRONMENT=qa    # qa on the QA app deployment, prod on production; required
OPENAI_API_KEY=
OPENAI_ANALYSIS_MODEL=        # e.g. gpt-5.6-luna
SITECORE_GRAPHQL_ENDPOINT=    # https://your-host/api/graphql/v1
SITECORE_EDGE_CONTEXT_ID=     # optional, sent as sc_apikey
SITECORE_GQL_TOKEN=           # optional, sent as X-GQL-TOKEN
SITECORE_RESIDENCE_DATASOURCE=# Sitecore datasource path
```

The first three Supabase variables remain assigned to the original chatbot project. Performance credentials are read lazily by `/api/performance`; other features do not require them. Runtime environment variables do not select the CLI migration target. Each CLI workdir must be linked separately to the appropriate hosted project.

`PERFORMANCE_ENVIRONMENT` must match the stored `performance_deployments.environment` value. It selects the dashboard's data environment, while the performance URL/key select the database project. The page reads the value on the server at request time and passes only the environment label to the browser.

## Sitecore integration

- `/api/sitecore/residence-selector` fetches residence data from Sitecore Delivery GraphQL.
- Used in `/chatbot-content-management` to pull and download province `.md` files.
- After downloading, upload the file to the correct residence bucket to trigger re-indexing.

## Migration discipline

- Maintain independent migration histories: `supabase/migrations/` for the original project and `infrastructure/performance/supabase/migrations/` for the new performance project.
- Use `npm run supabase:chatbot -- <command>` or `npm run supabase:performance -- <command>` so the target workdir is explicit. Link each setup to its own project reference; do not relink the original setup to deploy performance changes.
- Never copy the entire chatbot migration history into the performance setup or move applied migration files out of the original history. The new project will receive an initial migration containing its actual performance schema and dependencies only.
- Review pending migrations with `db push --dry-run` for the intended setup before deployment. The initial performance migration and historical data transfer are separate future tasks.
- **Never edit a migration that has already been applied** (`supabase db push` or applied via dashboard). Once pushed, a migration file is immutable history.
- To change an already-applied function or schema, create a new timestamped migration (`YYYYMMDDHHMMSS_description.sql`) using `create or replace function` or `alter table`.
- Migration filenames follow the pattern: `20260406130000_add_analytics_booker_profile.sql`.

## Testing

Tests live in `tests/` mirroring the `app/` structure. Run with `npm test`.

- Environment: jsdom
- Setup file: `tests/setup.ts`
- Mocks are cleared/reset/restored between tests (`clearMocks`, `mockReset`, `restoreMocks` all enabled)
- Coverage is tracked for API routes, hooks, actions, helpers, and key components

## Analytics sections

The analytics dashboard (`/chat-bot-analytics`) is split into four pages:

- **Overview** (`/overview`) — visitor/session counts, form stats, corporate vs residence split, duration, AI sentiment summary, booker conversion profile, language comparison; month-over-month comparison at the bottom with its own independent date controls
- **Insights & Content** (`/insights`) — AI-driven satisfaction, sentiment, intents, evidence; contact mention review; common word frequency; stopword management (admin only)
- **Visitors & Sessions** (`/visitors-sessions`) — paginated visitor list with filters, session list, conversation replay (by session or full), AI analysis per visitor, duration, review requests
- **Reviews** (`/reviews`) — all review requests across visitors, with status tracking and conversation replay

### Key analytics SQL functions

| Function | Page | Purpose |
|----------|------|---------|
| `analytics_overview_summary` | Overview | Visitor/session/form counts, top pages/residences/langs, corporate vs residence split |
| `analytics_ai_summary` | Overview | Sentiment counts and avg satisfaction score for all analyzed visitors |
| `analytics_duration_summary` | Overview | Avg conversation duration across all visitors |
| `analytics_duration_by_sentiment` | Overview | Avg duration broken out by sentiment bucket |
| `analytics_duration_bucket_summary` | Overview | Duration distribution (short/medium/long) overall and per sentiment |
| `analytics_monthly_comparison` | Overview | Side-by-side metric comparison for two calendar months (independent date controls, not tied to the page date range) |
| `analytics_booker_profile` | Overview | Intent, sentiment, satisfaction, and language breakdown for visitors who submitted a `chat_bot_book_a_tour` form |
| `analytics_lang_comparison` | Overview | Visitors, sessions, satisfaction, sentiment, and tour-booking conversions split by language |
| `analytics_contact_mentions` | Insights | Assistant messages containing phone/contact info, with preceding user question |

### Overview page date range

The date picker lives in the page header and applies to all sections **except** `MonthlyComparisonSection`, which has its own independent month selectors. `MonthlyComparisonSection` is rendered last with a labeled divider to make this separation clear.

### Booker conversion profile

`analytics_booker_profile(p_start, p_end)` joins three tables on `visitor_id`:
- `visitor_forms` — filters `is_submitted = true AND form_type = 'chat_bot_book_a_tour'` within the period
- `chat_visitor_analyses` — latest analysis per booker (no date restriction)
- `chat_sessions` — most-recent session for language split (en/fr)

Returns: `total_bookers`, `avg_satisfaction_bookers`, `avg_satisfaction_all`, `sentiment` split, `top_intents` ranked by count with %, `lang_split`.

### Language comparison

`analytics_lang_comparison(p_start, p_end)` assigns each visitor their primary language (most-used session `lang` in the period), then returns per-language: `visitor_count`, `session_count`, `analyzed_count`, `avg_satisfaction`, `satisfied`/`neutral`/`angry` counts, `form_submissions`. Uses latest `chat_visitor_analyses` per visitor with no date restriction (same pattern as booker profile). EN and FR are always shown first in the UI.

## Conversation analysis schema

`ConversationAnalysis` type (defined in [app/types/types.ts](app/types/types.ts)):

- `satisfaction_1_to_10`: 1–10 integer
- `sentiment`: `"satisfied" | "neutral" | "angry" | "unknown"`
- `intent_primary` + `intents[]`: 25-value enum (pricing, tour booking, care options, etc.)
- `evidence`: `{ visitor_goal, goal_met, key_quotes[] }`
- `missed_or_weak_answers[]`: unanswered question records
- `improvement`: actionable suggestion with category tag (e.g. `[clarify]`, `[accuracy]`)
- `summary`: 2–3 sentence outcome description

## Page type classification

Sessions are classified by `residence_custom_id`:
- `"corporateen"` or `"corporatefr"` → `"corporate"`
- URL contains `/find-a-residence` → `"find_a_residence"`
- Any other non-empty `residence_custom_id` → `"residence"`
- Otherwise → `"unknown"`
