


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "private"."admin_delete_visitor"("p_visitor_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  -- Only allow authenticated users (admin UI)
  if auth.role() <> 'authenticated' then
    raise exception 'not allowed';
  end if;

  delete from public.visitors where id = p_visitor_id;
end;
$$;


ALTER FUNCTION "private"."admin_delete_visitor"("p_visitor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."embed"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  content_column text = TG_ARGV[0];
  embedding_column text = TG_ARGV[1];
  batch_size int = case when array_length(TG_ARGV, 1) >= 3 then TG_ARGV[2]::int else 5 end;
  timeout_milliseconds int = case when array_length(TG_ARGV, 1) >= 4 then TG_ARGV[3]::int else 5 * 60 * 1000 end;
  batch_count int = ceiling((select count(*) from inserted) / batch_size::float);
begin
  -- Loop through each batch and invoke an edge function to handle the embedding generation
  for i in 0 .. (batch_count-1) loop
  perform
    net.http_post(
      url := supabase_url() || '/functions/v1/embed',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', current_setting('request.headers')::json->>'authorization'
      ),
      body := jsonb_build_object(
        'ids', (select json_agg(ds.id) from (select id from inserted limit batch_size offset i*batch_size) ds),
        'table', TG_TABLE_NAME,
        'contentColumn', content_column,
        'embeddingColumn', embedding_column
      ),
      timeout_milliseconds := timeout_milliseconds
    );
  end loop;

  return null;
end;
$$;


ALTER FUNCTION "private"."embed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."handle_storage_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  document_id bigint;
  result int;
  residence_id_val bigint;
  is_common_val boolean;
  scope_identifier text;
begin
  -- Extract scope from path: path_tokens[1] is either residence_custom_id or 'common'
  scope_identifier := new.path_tokens[1];
  
  if scope_identifier = 'common' then
    -- This is a common file
    is_common_val := true;
    residence_id_val := null;
  else
    -- This is a residence file, look up the residence_id
    select id into residence_id_val
    from residences
    where custom_id = scope_identifier;
    
    is_common_val := false;
    
    -- If residence doesn't exist, create it automatically
    if residence_id_val is null then
      insert into residences (name, custom_id)
      values (scope_identifier, scope_identifier)
      returning id into residence_id_val;
    end if;
  end if;

  -- Insert document with residence scoping
  insert into documents (name, storage_object_id, created_by, residence_id, is_common)
    values (new.path_tokens[3], new.id, new.owner, residence_id_val, is_common_val)
    returning id into document_id;

  -- Trigger processing
  select
    net.http_post(
      url := supabase_url() || '/functions/v1/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', current_setting('request.headers')::json->>'authorization'
      ),
      body := jsonb_build_object(
        'document_id', document_id
      )
    )
  into result;

  return null;
end;
$$;


ALTER FUNCTION "private"."handle_storage_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."uuid_or_null"("str" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
begin
  return str::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;


ALTER FUNCTION "private"."uuid_or_null"("str" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_visitor"("p_visitor_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Only allow authenticated users (your admin UI)
  if auth.role() <> 'authenticated' then
    raise exception 'not allowed';
  end if;

  delete from public.visitors
  where id = p_visitor_id;
end;
$$;


ALTER FUNCTION "public"."admin_delete_visitor"("p_visitor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."document_sections_tsvector_refresh"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.search_vector_en :=
    to_tsvector('english'::regconfig,
      unaccent('unaccent'::regdictionary, coalesce(new.content,'')));

  new.search_vector_fr :=
    to_tsvector('french'::regconfig,
      unaccent('unaccent'::regdictionary, coalesce(new.content,'')));

  return new;
end;
$$;


ALTER FUNCTION "public"."document_sections_tsvector_refresh"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, level, created_at)
  values (new.id, 3, now())
  on conflict (id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and level = 1
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."document_sections" (
    "id" bigint NOT NULL,
    "document_id" bigint NOT NULL,
    "content" "text" NOT NULL,
    "embedding" "extensions"."vector"(384),
    "search_vector_en" "tsvector",
    "search_vector_fr" "tsvector"
);


ALTER TABLE "public"."document_sections" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_document_sections"("embedding" "extensions"."vector", "match_threshold" double precision) RETURNS SETOF "public"."document_sections"
    LANGUAGE "plpgsql"
    AS $$
#variable_conflict use_variable
begin
  return query
  select *
  from document_sections

  -- The inner product is negative, so we negate match_threshold
  where document_sections.embedding <#> embedding < -match_threshold

  -- Our embeddings are normalized to length 1, so cosine similarity
  -- and inner product will produce the same query results.
  -- Using inner product which can be computed faster.
  --
  -- For the different distance functions, see https://github.com/pgvector/pgvector
  order by document_sections.embedding <#> embedding;
end;
$$;


ALTER FUNCTION "public"."match_document_sections"("embedding" "extensions"."vector", "match_threshold" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_document_sections"("embedding" "extensions"."vector", "match_threshold" double precision, "residence_custom_id" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."document_sections"
    LANGUAGE "plpgsql"
    AS $$
#variable_conflict use_variable
begin
  return query
  select ds.*
  from document_sections ds
  join documents d on d.id = ds.document_id
  left join residences r on r.id = d.residence_id
  where 
    -- Vector similarity check
    ds.embedding <#> embedding < -match_threshold
    -- Residence filtering logic
    and (
      -- If residence_custom_id is provided, match that residence + common
      (residence_custom_id is not null and (r.custom_id = residence_custom_id or d.is_common = true))
      -- If residence_custom_id is null, return only common documents
      or (residence_custom_id is null and d.is_common = true)
    )
  order by ds.embedding <#> embedding;
end;
$$;


ALTER FUNCTION "public"."match_document_sections"("embedding" "extensions"."vector", "match_threshold" double precision, "residence_custom_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_document_sections_public"("p_embedding" "extensions"."vector", "p_match_threshold" double precision, "p_residence_custom_id" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS SETOF "public"."document_sections"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select ds.*
  from document_sections ds
  join documents d on d.id = ds.document_id
  left join residences r on r.id = d.residence_id
  where
    (1 - (ds.embedding <#> p_embedding)) >= p_match_threshold    -- cosine similarity
    and (
      (p_residence_custom_id is not null and (r.custom_id = p_residence_custom_id or d.is_common))
      or (p_residence_custom_id is null and d.is_common)
    )
  order by ds.embedding <#> p_embedding asc
  limit greatest(1, least(p_limit, 50));
$$;


ALTER FUNCTION "public"."match_document_sections_public"("p_embedding" "extensions"."vector", "p_match_threshold" double precision, "p_residence_custom_id" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_sections_ml"("q" "text", "p_residence_custom_id" "text", "p_lang" "text" DEFAULT 'auto'::"text", "p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS TABLE("section_id" bigint, "document_id" bigint, "document_name" "text", "residence_custom_id" "text", "is_common" boolean, "content" "text", "snippet" "text", "rank" real, "lang" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$with inputs as (
  select 
    lower(unaccent(trim(coalesce(q, '')))) as clean_q,
    case 
      when lower(p_lang) in ('fr','french','francais','français') then 'fr'
      when lower(p_lang) in ('en','english')                     then 'en'
      else 'auto'
    end as mode
),

ts_queries as (
  select
    phraseto_tsquery('english', clean_q)                           as en_phrase,
    plainto_tsquery('english', clean_q)                            as en_and,
    websearch_to_tsquery('english', replace(clean_q, ' ', ' or ')) as en_or,

    phraseto_tsquery('french',  clean_q)                           as fr_phrase,
    plainto_tsquery('french',  clean_q)                            as fr_and,
    websearch_to_tsquery('french',  replace(clean_q, ' ', ' or ')) as fr_or,

    clean_q,
    mode
  from inputs
),

tokenized as (
  select tok
  from unnest(regexp_split_to_array((select clean_q from inputs), '\s+')) tok
  where tok <> ''
),

hits as (
  select
    ds.id as section_id,
    count(*) filter (where ds.search_vector_en @@ plainto_tsquery('english', tok)) +
    count(*) filter (where ds.search_vector_fr @@ plainto_tsquery('french', tok))
      as hit_count
  from document_sections ds
  join documents d on d.id = ds.document_id
  left join residences r on r.id = d.residence_id
  cross join tokenized
  where
    (
      p_residence_custom_id is not null 
      and p_residence_custom_id <> ''
      and r.custom_id::text = p_residence_custom_id  -- STRING COMPARE, ALWAYS SAFE
    )
    or
    (
      (p_residence_custom_id is null or p_residence_custom_id = '')
      and d.is_common
    )
  group by ds.id
)

select
  ds.id as section_id,
  ds.document_id,
  d.name as document_name,
  r.custom_id::text as residence_custom_id,
  d.is_common,
  ds.content,

  -- Snippet
  case 
    when q.mode = 'fr' then 
      ts_headline('french', ds.content, coalesce(q.fr_phrase, q.fr_and, q.fr_or),
        'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=10,MaxWords=35')
    when q.mode = 'en' then 
      ts_headline('english', ds.content, coalesce(q.en_phrase, q.en_and, q.en_or),
        'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=10,MaxWords=35')
    else 
      coalesce(
        nullif(
          ts_headline('english', ds.content, coalesce(q.en_phrase, q.en_and, q.en_or),
            'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=10,MaxWords=35'),
          ''
        ),
        ts_headline('french', ds.content, coalesce(q.fr_phrase, q.fr_and, q.fr_or),
          'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=10,MaxWords=35')
      )
  end as snippet,

  -- Rank
  (
    greatest(
      case when q.mode in ('en','auto') then
        ts_rank_cd(ds.search_vector_en, coalesce(q.en_phrase, q.en_and, q.en_or)) * 1.0 +
        ts_rank_cd(ds.search_vector_en, q.en_and) * 0.8 +
        ts_rank   (ds.search_vector_en, q.en_or) * 0.1
      else 0 end,

      case when q.mode in ('fr','auto') then
        ts_rank_cd(ds.search_vector_fr, coalesce(q.fr_phrase, q.fr_and, q.fr_or)) * 1.0 +
        ts_rank_cd(ds.search_vector_fr, q.fr_and) * 0.8 +
        ts_rank   (ds.search_vector_fr, q.fr_or) * 0.1
      else 0 end
    )
    + (similarity(ds.content, q.clean_q) * 0.10)
    + (coalesce(h.hit_count, 0) * 0.20)
    + (case when coalesce(h.hit_count,0) >= 2 then 0.25 else 0 end)
    + case
        when length(ds.content) < 60  then -0.35
        when length(ds.content) < 140 then -0.15
        else 0
      end
  ) as rank,

  -- Chosen language
  case 
    when q.mode = 'auto' then 
      case 
        when ts_rank(ds.search_vector_fr, q.fr_or) > ts_rank(ds.search_vector_en, q.en_or) 
        then 'fr' else 'en'
      end
    else q.mode
  end as lang

from document_sections ds
join documents d on d.id = ds.document_id
left join residences r on r.id = d.residence_id
cross join ts_queries q
left join hits h on h.section_id = ds.id

where
  (
    p_residence_custom_id is not null 
    and p_residence_custom_id <> ''
    and r.custom_id::text = p_residence_custom_id   -- SAFE
  )
  or
  (
    (p_residence_custom_id is null or p_residence_custom_id = '')
    and d.is_common
  )

  and (
    (q.mode in ('en','auto') and ds.search_vector_en @@ q.en_or)
    or
    (q.mode in ('fr','auto') and ds.search_vector_fr @@ q.fr_or)
    or
    similarity(ds.content, q.clean_q) > 0.15
  )

order by rank desc
limit greatest(1, least(p_limit, 50))
offset greatest(0, p_offset);$$;


ALTER FUNCTION "public"."search_sections_ml"("q" "text", "p_residence_custom_id" "text", "p_lang" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."supabase_url"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  secret_value text;
begin
  select decrypted_secret into secret_value from vault.decrypted_secrets where name = 'supabase_url';
  return secret_value;
end;
$$;


ALTER FUNCTION "public"."supabase_url"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profile_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_profile_email"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_message_sources" (
    "id" bigint NOT NULL,
    "assistant_message_id" bigint NOT NULL,
    "document_section_id" bigint NOT NULL,
    "rank" integer DEFAULT 1 NOT NULL,
    "score" double precision,
    "source_type" "text",
    "snippet_used" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_id" "uuid",
    "user_message_id" bigint,
    CONSTRAINT "chat_message_sources_rank_check" CHECK (("rank" >= 1))
);


ALTER TABLE "public"."chat_message_sources" OWNER TO "postgres";


ALTER TABLE "public"."chat_message_sources" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chat_message_sources_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" bigint NOT NULL,
    "session_id" "uuid" NOT NULL,
    "visitor_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


ALTER TABLE "public"."chat_messages" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chat_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chat_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visitor_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "page_url" "text",
    "residence_custom_id" "text",
    "lang" "text"
);


ALTER TABLE "public"."chat_sessions" OWNER TO "postgres";


ALTER TABLE "public"."document_sections" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."document_sections_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "storage_object_id" "uuid" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "residence_id" bigint,
    "is_common" boolean DEFAULT false NOT NULL,
    CONSTRAINT "documents_scope_check" CHECK (((("residence_id" IS NOT NULL) AND ("is_common" = false)) OR (("residence_id" IS NULL) AND ("is_common" = true))))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


ALTER TABLE "public"."documents" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."documents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."residences" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "custom_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"()
);


ALTER TABLE "public"."residences" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."documents_with_storage_path" WITH ("security_invoker"='true') AS
 SELECT "documents"."id",
    "documents"."name",
    "documents"."storage_object_id",
    "documents"."created_by",
    "documents"."created_at",
    "documents"."residence_id",
    "documents"."is_common",
    "objects"."name" AS "storage_object_path",
    "residences"."name" AS "residence_name",
    "residences"."custom_id" AS "residence_custom_id"
   FROM (("public"."documents"
     JOIN "storage"."objects" ON (("objects"."id" = "documents"."storage_object_id")))
     LEFT JOIN "public"."residences" ON (("residences"."id" = "documents"."residence_id")));


ALTER VIEW "public"."documents_with_storage_path" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "level" smallint DEFAULT 3 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    CONSTRAINT "profiles_level_check" CHECK (("level" = ANY (ARRAY[1, 2, 3])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE "public"."residences" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."residences_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."visitor_forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visitor_id" "uuid" NOT NULL,
    "form_type" "text" NOT NULL,
    "submitted_with_button" "text" NOT NULL,
    "is_submitted" boolean DEFAULT false NOT NULL,
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visitor_forms_submitted_with_button_check" CHECK (("submitted_with_button" = ANY (ARRAY['dynamic'::"text", 'static'::"text"])))
);


ALTER TABLE "public"."visitor_forms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visitors" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."visitors" OWNER TO "postgres";


ALTER TABLE ONLY "public"."chat_message_sources"
    ADD CONSTRAINT "chat_message_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_sections"
    ADD CONSTRAINT "document_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."residences"
    ADD CONSTRAINT "residences_custom_id_key" UNIQUE ("custom_id");



ALTER TABLE ONLY "public"."residences"
    ADD CONSTRAINT "residences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visitor_forms"
    ADD CONSTRAINT "visitor_forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visitors"
    ADD CONSTRAINT "visitors_pkey" PRIMARY KEY ("id");



CREATE INDEX "document_sections_embedding_idx" ON "public"."document_sections" USING "hnsw" ("embedding" "extensions"."vector_ip_ops");



CREATE INDEX "idx_chat_message_sources_msg_rank" ON "public"."chat_message_sources" USING "btree" ("assistant_message_id", "rank");



CREATE INDEX "idx_chat_message_sources_section" ON "public"."chat_message_sources" USING "btree" ("document_section_id");



CREATE INDEX "idx_chat_messages_role" ON "public"."chat_messages" USING "btree" ("role");



CREATE INDEX "idx_chat_messages_session_created" ON "public"."chat_messages" USING "btree" ("session_id", "created_at");



CREATE INDEX "idx_chat_messages_visitor_created" ON "public"."chat_messages" USING "btree" ("visitor_id", "created_at" DESC);



CREATE INDEX "idx_chat_sessions_created" ON "public"."chat_sessions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_chat_sessions_visitor_created" ON "public"."chat_sessions" USING "btree" ("visitor_id", "created_at" DESC);



CREATE INDEX "idx_doc_sections_fts_en" ON "public"."document_sections" USING "gin" ("search_vector_en");



CREATE INDEX "idx_doc_sections_fts_fr" ON "public"."document_sections" USING "gin" ("search_vector_fr");



CREATE INDEX "idx_sections_embedding" ON "public"."document_sections" USING "ivfflat" ("embedding" "extensions"."vector_cosine_ops") WITH ("lists"='100');



CREATE UNIQUE INDEX "uq_chat_message_sources_msg_section" ON "public"."chat_message_sources" USING "btree" ("assistant_message_id", "document_section_id");



CREATE INDEX "visitor_forms_form_type_idx" ON "public"."visitor_forms" USING "btree" ("form_type");



CREATE INDEX "visitor_forms_submitted_at_idx" ON "public"."visitor_forms" USING "btree" ("submitted_at" DESC);



CREATE INDEX "visitor_forms_submitted_idx" ON "public"."visitor_forms" USING "btree" ("is_submitted", "submitted_at");



CREATE INDEX "visitor_forms_visitor_id_idx" ON "public"."visitor_forms" USING "btree" ("visitor_id");



CREATE OR REPLACE TRIGGER "embed_document_sections" AFTER INSERT ON "public"."document_sections" REFERENCING NEW TABLE AS "inserted" FOR EACH STATEMENT EXECUTE FUNCTION "private"."embed"('content', 'embedding');



CREATE OR REPLACE TRIGGER "trg_document_sections_tsvector_refresh" BEFORE INSERT OR UPDATE OF "content" ON "public"."document_sections" FOR EACH ROW EXECUTE FUNCTION "public"."document_sections_tsvector_refresh"();



ALTER TABLE ONLY "public"."chat_message_sources"
    ADD CONSTRAINT "chat_message_sources_assistant_message_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_message_sources"
    ADD CONSTRAINT "chat_message_sources_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_message_sources"
    ADD CONSTRAINT "chat_message_sources_document_section_id_fkey" FOREIGN KEY ("document_section_id") REFERENCES "public"."document_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_message_sources"
    ADD CONSTRAINT "chat_message_sources_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_message_sources"
    ADD CONSTRAINT "chat_message_sources_user_message_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_sections"
    ADD CONSTRAINT "document_sections_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_residence_id_fkey" FOREIGN KEY ("residence_id") REFERENCES "public"."residences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage"."objects"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visitor_forms"
    ADD CONSTRAINT "visitor_forms_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can delete document sections" ON "public"."document_sections" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can delete documents" ON "public"."documents" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can delete residences" ON "public"."residences" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can insert document sections" ON "public"."document_sections" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can insert documents" ON "public"."documents" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can insert residences" ON "public"."residences" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can select document sections" ON "public"."document_sections" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can select documents" ON "public"."documents" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can select residences" ON "public"."residences" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can update document sections" ON "public"."document_sections" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can update documents" ON "public"."documents" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Authenticated users can update residences" ON "public"."residences" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "admin_read_all_profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_update_profiles" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "anon_insert_chat_message_sources" ON "public"."chat_message_sources" FOR INSERT TO "anon" WITH CHECK ((("assistant_message_id" IS NOT NULL) AND ("document_section_id" IS NOT NULL)));



CREATE POLICY "anon_insert_chat_messages" ON "public"."chat_messages" FOR INSERT TO "anon" WITH CHECK ((("private"."uuid_or_null"(("visitor_id")::"text") IS NOT NULL) AND ("private"."uuid_or_null"(("session_id")::"text") IS NOT NULL) AND ("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])) AND ("content" IS NOT NULL)));



CREATE POLICY "anon_insert_chat_sessions" ON "public"."chat_sessions" FOR INSERT TO "anon" WITH CHECK ((("private"."uuid_or_null"(("id")::"text") IS NOT NULL) AND ("private"."uuid_or_null"(("visitor_id")::"text") IS NOT NULL)));



CREATE POLICY "anon_insert_visitor_forms" ON "public"."visitor_forms" FOR INSERT TO "anon" WITH CHECK ((("private"."uuid_or_null"(("visitor_id")::"text") IS NOT NULL) AND ("form_type" IS NOT NULL) AND ("submitted_with_button" = ANY (ARRAY['dynamic'::"text", 'static'::"text"])) AND ("is_submitted" IS NOT NULL)));



CREATE POLICY "anon_insert_visitors" ON "public"."visitors" FOR INSERT TO "anon" WITH CHECK (("private"."uuid_or_null"(("id")::"text") IS NOT NULL));



CREATE POLICY "anon_select_chat_messages" ON "public"."chat_messages" FOR SELECT TO "anon" USING (true);



CREATE POLICY "anon_select_chat_sessions" ON "public"."chat_sessions" FOR SELECT TO "anon" USING (("private"."uuid_or_null"(("visitor_id")::"text") IS NOT NULL));



CREATE POLICY "anon_select_visitor_forms" ON "public"."visitor_forms" FOR SELECT TO "anon" USING (true);



CREATE POLICY "anon_select_visitors" ON "public"."visitors" FOR SELECT TO "anon" USING (("private"."uuid_or_null"(("id")::"text") IS NOT NULL));



CREATE POLICY "anon_update_chat_sessions_same_id" ON "public"."chat_sessions" FOR UPDATE TO "anon" USING (("private"."uuid_or_null"(("id")::"text") IS NOT NULL)) WITH CHECK ((("private"."uuid_or_null"(("id")::"text") IS NOT NULL) AND ("private"."uuid_or_null"(("visitor_id")::"text") IS NOT NULL)));



CREATE POLICY "anon_update_visitor_forms" ON "public"."visitor_forms" FOR UPDATE TO "anon" USING (("private"."uuid_or_null"(("visitor_id")::"text") IS NOT NULL)) WITH CHECK ((("private"."uuid_or_null"(("visitor_id")::"text") IS NOT NULL) AND ("form_type" IS NOT NULL) AND ("submitted_with_button" = ANY (ARRAY['dynamic'::"text", 'static'::"text"])) AND ("is_submitted" IS NOT NULL)));



CREATE POLICY "anon_update_visitors_same_id" ON "public"."visitors" FOR UPDATE TO "anon" USING (("private"."uuid_or_null"(("id")::"text") IS NOT NULL)) WITH CHECK (("private"."uuid_or_null"(("id")::"text") IS NOT NULL));



CREATE POLICY "auth_select_chat_message_sources" ON "public"."chat_message_sources" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_chat_messages" ON "public"."chat_messages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_chat_sessions" ON "public"."chat_sessions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_visitor_forms" ON "public"."visitor_forms" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_visitors" ON "public"."visitors" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."chat_message_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cms_insert" ON "public"."chat_message_sources" FOR INSERT TO "authenticated", "anon" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."chat_sessions" "s"
  WHERE ("s"."id" = "chat_message_sources"."session_id"))) AND (EXISTS ( SELECT 1
   FROM ("public"."chat_messages" "um"
     JOIN "public"."chat_sessions" "s" ON (("s"."id" = "chat_message_sources"."session_id")))
  WHERE (("um"."id" = "chat_message_sources"."user_message_id") AND ("um"."session_id" = "chat_message_sources"."session_id") AND ("um"."visitor_id" = "s"."visitor_id")))) AND (EXISTS ( SELECT 1
   FROM ("public"."chat_messages" "am"
     JOIN "public"."chat_sessions" "s" ON (("s"."id" = "chat_message_sources"."session_id")))
  WHERE (("am"."id" = "chat_message_sources"."assistant_message_id") AND ("am"."session_id" = "chat_message_sources"."session_id") AND ("am"."visitor_id" = "s"."visitor_id"))))));



ALTER TABLE "public"."document_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "read_own_profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."residences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visitor_forms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visitors" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
















































GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";


































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "private"."admin_delete_visitor"("p_visitor_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."admin_delete_visitor"("p_visitor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_visitor"("p_visitor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."document_sections_tsvector_refresh"() TO "anon";
GRANT ALL ON FUNCTION "public"."document_sections_tsvector_refresh"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."document_sections_tsvector_refresh"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON TABLE "public"."document_sections" TO "anon";
GRANT ALL ON TABLE "public"."document_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."document_sections" TO "service_role";












REVOKE ALL ON FUNCTION "public"."search_sections_ml"("q" "text", "p_residence_custom_id" "text", "p_lang" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_sections_ml"("q" "text", "p_residence_custom_id" "text", "p_lang" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_sections_ml"("q" "text", "p_residence_custom_id" "text", "p_lang" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_sections_ml"("q" "text", "p_residence_custom_id" "text", "p_lang" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."supabase_url"() TO "anon";
GRANT ALL ON FUNCTION "public"."supabase_url"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."supabase_url"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_profile_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_profile_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_profile_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";






























GRANT ALL ON TABLE "public"."chat_message_sources" TO "anon";
GRANT ALL ON TABLE "public"."chat_message_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_message_sources" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chat_message_sources_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chat_message_sources_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chat_message_sources_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chat_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chat_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chat_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_sections_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_sections_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_sections_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."residences" TO "anon";
GRANT ALL ON TABLE "public"."residences" TO "authenticated";
GRANT ALL ON TABLE "public"."residences" TO "service_role";



GRANT ALL ON TABLE "public"."documents_with_storage_path" TO "anon";
GRANT ALL ON TABLE "public"."documents_with_storage_path" TO "authenticated";
GRANT ALL ON TABLE "public"."documents_with_storage_path" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."residences_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."residences_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."residences_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."visitor_forms" TO "anon";
GRANT ALL ON TABLE "public"."visitor_forms" TO "authenticated";
GRANT ALL ON TABLE "public"."visitor_forms" TO "service_role";



GRANT ALL ON TABLE "public"."visitors" TO "anon";
GRANT ALL ON TABLE "public"."visitors" TO "authenticated";
GRANT ALL ON TABLE "public"."visitors" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
