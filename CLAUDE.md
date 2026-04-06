# Chartwell Manager — CLAUDE.md

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
```

## Architecture

### Tech stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5.9
- **Backend/DB**: Supabase (Auth, PostgreSQL, Storage, Edge Functions)
- **Styling**: Tailwind CSS 3, shadcn/ui (Radix UI primitives)
- **Data fetching**: TanStack React Query v5
- **Charts**: Recharts
- **AI**: OpenAI API (via `OPENAI_ANALYSIS_MODEL` env, default `gpt-5.2`)
- **Testing**: Vitest 4, jsdom, @testing-library/react

### Directory layout
```
app/                          # Next.js App Router pages and API routes
  api/                        # API route handlers
    analytics/                # Analytics data endpoints
    chat/                     # Prompt testing and analyzer testing
    sitecore/                 # Sitecore residence selector integration
  auth/callback/              # Supabase auth code exchange
  chat-bot-analytics/         # Analytics pages and section components
  chatbot-content-management/ # Document/residence management
  chatbot-prompt-testing/     # Prompt testing UI
  const/userLevels.tsx        # Access level definitions and allowed route prefixes
  helpers/                    # Shared helpers (fmtDate, etc.)
  hooks/                      # Custom React hooks
  login/                      # Login page and server actions
  team/                       # Team management page
  types/types.ts              # Shared TypeScript types
  utils/supabase/             # Supabase SSR client helpers (client.ts, server.ts)
components/                   # Shared UI components
  NavLink/                    # Navigation components
  LoginForm/
  LogoutButton/
  ui/                         # shadcn/ui primitives
lib/                          # Shared library code (providers, utils, chatbot prompts)
supabase/
  functions/                  # Deno Edge Functions
    analyze-conversations/    # AI conversation analysis job
    conversation-durations/   # Duration computation job
    embed/                    # Embedding generation
    process/                  # Document processing pipeline
    search-vector/            # Vector search
    _lib/                     # Shared library (database types, markdown parser)
  migrations/                 # SQL migration files (timestamped)
tests/                        # Vitest test files mirroring app/ structure
```

### Path alias
`@` maps to the project root (configured in `vitest.config.ts` and `tsconfig.json`).

## Access levels

Defined in [app/const/userLevels.tsx](app/const/userLevels.tsx). Access is controlled by `profiles.level` in Supabase.

| Level | Role | Access |
|-------|------|--------|
| 1 | Admin | Full access, team management, delete visitor data, all API routes |
| 2 | Content Team | Content management + analytics + prompt testing |
| 3 | Basic | Analytics and team pages only |

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

All functions live in `supabase/functions/` and run as Deno processes:

| Function | Purpose |
|----------|---------|
| `process` | Downloads uploaded document, splits markdown into sections, inserts `document_sections` |
| `embed` | Generates embeddings for rows missing them |
| `search-vector` | Generates query embedding and calls `match_document_sections_public` |
| `analyze-conversations` | AI analysis job: fetches unanalyzed visitors, calls OpenAI, stores results in `chat_visitor_analyses` |
| `conversation-durations` | Computes per-visitor and per-session duration metrics |

The analyzer uses `OPENAI_ANALYSIS_MODEL` env var (default `gpt-5.2`) and stores results with `prompt_version: "v1"`. The analyzer prompt is defined in `lib/chatbot/analyzerPrompt.ts` and reused in both the edge function and the analytics UI.

## Environment variables

Copy `.env.local.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_DB_URL=              # postgresql://USER:PASSWORD@HOST:PORT/DB
OPENAI_API_KEY=
OPENAI_ANALYSIS_MODEL=        # e.g. gpt-5.2
SITECORE_GRAPHQL_ENDPOINT=    # https://your-host/api/graphql/v1
SITECORE_EDGE_CONTEXT_ID=     # optional, sent as sc_apikey
SITECORE_GQL_TOKEN=           # optional, sent as X-GQL-TOKEN
SITECORE_RESIDENCE_DATASOURCE=# Sitecore datasource path
```

## Sitecore integration

- `/api/sitecore/residence-selector` fetches residence data from Sitecore Delivery GraphQL.
- Used in `/chatbot-content-management` to pull and download province `.md` files.
- After downloading, upload the file to the correct residence bucket to trigger re-indexing.

## Migration discipline

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
- **Insights & Content** (`/insights`) — document & source performance (all-time, first section); AI-driven satisfaction, sentiment, intents, evidence; contact mention review; common word frequency; stopword management (admin only)
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
| `analytics_source_performance` | Insights | Citation counts per document and section from `chat_message_sources`; dead-document list (zero citations all-time) |

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

### Document & source performance

`analytics_source_performance(p_start, p_end, p_limit)` is always called with `p_start = null, p_end = null` (all-time — the section has no date filter). Returns:
- `top_documents` — documents ranked by total citations aggregated from all their sections
- `top_sections` — individual sections ranked by citation count with content preview (shown via toggle)
- `dead_documents` — documents with zero citations ever (actionable dead content list)
- `total_citations`, `total_cited_sections`, `total_documents`, `dead_document_count`

`SourcePerformanceSection` accepts no date props. It is the first section on the Insights & Content page.

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
