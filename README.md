# Chartwell Manager

Chartwell Manager is a Next.js + Supabase admin console for managing residence-specific chatbot content and reviewing chatbot analytics. It provides role-based access for internal teams, content upload/management, and replayable analytics for visitor conversations.

## What it does
- Authenticates staff with Supabase Auth (email/password + OTP).
- Manages residence records and the documents used by the chatbot.
- Tracks visitors, chat sessions, messages, and source citations for analytics.
- Shows website performance scores, overall and per-page trends, and deployment changes from a separate Supabase project.
- Allows admins to manage team access levels and delete visitor data.

## How it works
- Auth is handled via Supabase SSR helpers in `app/utils/supabase`.
- After login, users are routed into the app, with access controlled by `profiles.level`.
- Content management uploads files to the `files` storage bucket and lists documents from the `documents_with_storage_path` view.
- Supabase Edge Functions process documents into sections and generate embeddings for search.
- Analytics pages query visitor/session/message tables and show a replay view with source citations.
- Website performance requests authenticate with the original project, then query the separate performance project through `/api/performance`.

## Supabase projects

The application keeps one login and uses two databases:

| Project | Data | Configuration |
| --- | --- | --- |
| Original chatbot project | Auth, profiles, chatbot conversations and analytics, content, documents, Storage, existing jobs | Existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`; `supabase/` |
| New performance project | Website deployments, Lighthouse attempts, page results, deployment commits | Server-only `PERFORMANCE_SUPABASE_URL`, `PERFORMANCE_SUPABASE_SECRET_KEY`; `infrastructure/performance/supabase/` |

Keep the existing public Supabase values assigned to the original project. Every signed-in application user can view website performance through the API; the new project does not need a second set of users.

The separate configuration and empty migration/function folders are prepared. The hosted project, initial schema migration, historical data transfer, and ingestion destination still need to be set up. See the [performance project setup](infrastructure/performance/README.md).

Until performance credentials are configured, its API returns a setup error. It does not query performance tables in the old project as a fallback. The rest of the application keeps using the original project.

Each app deployment shows one performance environment: set the server-only `PERFORMANCE_ENVIRONMENT=qa` on QA and `PERFORMANCE_ENVIRONMENT=prod` on production. The dashboard displays a fixed environment badge, and its deployment/history queries use that value. There is no environment dropdown or DEV fallback. The value must match the environment stored by performance ingestion; the performance URL/key still select the database project.

## App routes
- `/` landing page; redirects authenticated users to content management.
- `/login` email/password + OTP flow.
- `/verify-email` confirmation message after signup.
- `/auth/callback` Supabase auth code exchange.
- `/chatbot-content-management` residences + document management.
- `/chat-bot-analytics` visitor/session analytics + conversation replay.
- `/chartwell-website-performance` Lighthouse performance dashboard, page trends, and deployment history. See the [dashboard README](app/chartwell-website-performance/README.md) for data flow, calculations, and visible/hidden fields.
- `/team` team access management.
- `/not-authorized` access fallback for restricted routes.

## Access levels
- Level 1 (Admin): full access, can manage team roles and delete visitor data.
- Level 2 (Content Team): manage content + analytics; cannot delete visitor data.
- Level 3 (Basic): analytics only; cannot manage content or delete visitor data.

## Database model (from `assets/step-2-er-diagram.png`)
Core tables and relationships:
- `auth.users` (Supabase Auth)
- `profiles`
  - `id` (uuid, PK, FK -> `auth.users.id`)
  - `level` (int2)
  - `created_at` (timestamptz)
  - `email` (text, used by team view)
- `visitors`
  - `id` (uuid, PK)
  - `created_at`
- `chat_sessions`
  - `id` (uuid, PK)
  - `visitor_id` (FK -> `visitors.id`)
  - `created_at`, `page_url`, `residence_custom_id`, `lang`
- `chat_messages`
  - `id` (int8, PK)
  - `session_id` (FK -> `chat_sessions.id`)
  - `visitor_id` (FK -> `visitors.id`)
  - `role`, `content`, `created_at`
- `chat_message_sources`
  - `id` (int8, PK)
  - `assistant_message_id` (FK -> `chat_messages.id`)
  - `user_message_id` (FK -> `chat_messages.id`, optional)
  - `session_id` (FK -> `chat_sessions.id`, optional)
  - `document_section_id` (FK -> `document_sections.id`)
  - `rank`, `score`, `source_type`, `snippet_used`, `created_at`
- `visitor_forms`
  - `id` (uuid, PK)
  - `visitor_id` (FK -> `visitors.id`)
  - `form_type`, `submitted_with_button`, `is_submitted`, `submitted_at`, `created_at`
- `residences`
  - `id` (int8, PK)
  - `name`, `custom_id`, `created_at`, `created_by`
- `documents`
  - `id` (int8, PK)
  - `name`, `storage_object_id` (FK -> `storage.objects.id`)
  - `created_by` (FK -> `auth.users.id`)
  - `created_at`, `residence_id` (FK -> `residences.id`), `is_common`
- `document_sections`
  - `id` (int8, PK)
  - `document_id` (FK -> `documents.id`)
  - `content`, `embedding`, `search_vector_en`, `search_vector_fr`
- `storage.objects` (Supabase Storage)
  - referenced by `documents.storage_object_id`

Helpful view:
- `documents_with_storage_path` joins documents to storage paths and residence metadata for the UI.

## Supabase Edge Functions
- `supabase/functions/process`: downloads an uploaded document, splits markdown into sections, inserts `document_sections`.
- `supabase/functions/embed`: generates embeddings for rows missing embeddings.
- `supabase/functions/search-vector`: generates an embedding for a query and calls `match_document_sections_public`.

## Sitecore integration
- The Residence Manager pulls residence data from Sitecore via `/api/sitecore/residence-selector`.
- The API route connects to the Sitecore Delivery GraphQL endpoint using `SITECORE_GRAPHQL_ENDPOINT` and `SITECORE_RESIDENCE_DATASOURCE`.
- If your Sitecore environment requires auth, set `SITECORE_EDGE_CONTEXT_ID` (sent as `sc_apikey`) and/or `SITECORE_GQL_TOKEN` (sent as `X-GQL-TOKEN`).
- Configure these values in `.env.local` (see `.env.local.example`).

## Updating residences from Sitecore
- Open `/chatbot-content-management` with no residence selected to see the Sitecore panel.
- Choose a language (EN/FR), then click `Load Sitecore` to pull the latest data.
- For each province, click `Download .md`.
- In the residence list, select `corporateen` or `corporatefr` (matching the selected language).
- Remove the old file and upload the new file with the same name.
- Uploading triggers the re-indexing pipeline (parse metadata, generate embeddings, refresh search).

## Updating a residence record
- Select a residence in the left panel and click the pencil icon to edit.
- Update the display name and `custom_id`.
- `custom_id` must be lowercase letters, numbers, and hyphens and is used as the storage/search scope.
- Keep `custom_id` aligned with downstream conventions (for example `11034en` / `11034fr` if your property IDs are language-specific).

## Local setup
1. Copy `.env.local.example` to `.env.local` and fill in Supabase values.
2. Install dependencies and run the dev server.

Use the original project's values for login/chatbot configuration. Add the new project's server-only performance values when it exists; creating its schema is a separate step. Never put the performance secret in a `NEXT_PUBLIC_` variable.

```bash
npm install
npm run dev
```

## Useful scripts
- `npm run dev`: start Next.js dev server.
- `npm run build`: build the app.
- `npm run start`: run the production server.
- `npm run typecheck`: run TypeScript checks across the app and tests.
- `npm run ci`: run the local CI gate (`typecheck`, tests, production build).
- `npm run gen:types`: regenerate Supabase types in `supabase/functions/_lib/database.ts`.
- `npm run gen:types:performance`: generate the separate local performance schema's types in `infrastructure/performance/database.types.ts`, after its schema exists.
- `npm run supabase:chatbot -- <command>`: use the original project's Supabase CLI setup.
- `npm run supabase:performance -- <command>`: use the new performance project's Supabase CLI setup. The folders have independent project links and migration histories.
- `npm test`: run the full automated test suite once.
- `npm run test:watch`: run tests in watch mode.
- `npm run test:coverage`: run tests with a V8 coverage report (`coverage/index.html`).
- 
pm run test:ui: open Vitest interactive UI (default http://localhost:51204).

