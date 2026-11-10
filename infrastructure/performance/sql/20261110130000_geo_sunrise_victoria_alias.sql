-- PERFORMANCE project only. Register one verified residence-to-operator alias.
-- Source checked 2026-11-10:
-- https://www.sunriseseniorliving.ca/en/communities/bc/sunrise-of-victoria
-- That official Sunrise Senior Living community page identifies Sunrise of Victoria.
-- The brand UUID below is from the failed run's supplied extraction JSON.
-- Preserves existing aliases, IDs, completed answers, and reporting history.
-- Does not relax ownership validation or start AI requests. Safe to rerun.
-- The worker reads the brand catalog on each stage; no redeployment is required.

do $geo_brand_alias$
declare
 target_id constant uuid := 'a62bd9a8-6865-4606-8322-d5fa975d3f27';
 residence_alias constant text := 'Sunrise of Victoria';
 target_brand public.geo_brands%rowtype;
begin
 perform pg_advisory_xact_lock(hashtext('geo-brand-alias:sunrise-of-victoria'));
 select * into target_brand from public.geo_brands where id=target_id for update;
 if target_brand.id is null or target_brand.is_chartwell
   or lower(regexp_replace(btrim(target_brand.name),'[[:space:]]+',' ','g'))<>'sunrise senior living' then
  raise exception 'Expected Sunrise Senior Living brand % was not found. Inspect geo_brands before applying this alias.',target_id;
 end if;
 if exists(select 1 from public.geo_brands b where b.id<>target_id and (
   lower(btrim(b.name))=lower(residence_alias)
   or exists(select 1 from unnest(b.aliases) a(value) where lower(btrim(a.value))=lower(residence_alias))
 )) then
  raise exception 'Sunrise of Victoria is already registered to another brand. Resolve that catalog conflict before retrying.';
 end if;
 if not exists(select 1 from unnest(target_brand.aliases) a(value)
   where lower(btrim(a.value))=lower(residence_alias)) then
  update public.geo_brands set aliases=array_append(aliases,residence_alias) where id=target_id;
 end if;
end;
$geo_brand_alias$;

select id,name,aliases from public.geo_brands
where id='a62bd9a8-6865-4606-8322-d5fa975d3f27'::uuid;
