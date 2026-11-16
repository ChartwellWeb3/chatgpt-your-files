// @vitest-environment node
// Supplied for later execution. Tests/builds are intentionally not run.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite; let original: string; let upgrade: string;
const admin = "00000000-0000-4000-8000-000000000001";
const content = "00000000-0000-4000-8000-000000000002";
const basic = "00000000-0000-4000-8000-000000000003";
async function grants(id: string) { return (await db.query<{ feature_access: Record<string, boolean> }>("select feature_access from profiles where id=$1", [id])).rows[0].feature_access; }
async function change(id: string, enabled: boolean, feature = "sitecore_pricing") { return db.query("select set_profile_feature_access($1,$2,$3)", [id, feature, enabled]); }
async function asUser(id: string, operation: () => Promise<unknown>) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try { return await operation(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  original = await readFile(new URL("../../supabase/migrations/20261110120000_add_profile_feature_access.sql", import.meta.url), "utf8");
  upgrade = await readFile(new URL("../../supabase/migrations/20261116170000_add_sitecore_pricing_feature_access.sql", import.meta.url), "utf8");
});
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.profiles(id uuid primary key,level integer not null default 3);
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.profiles where id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid and level=1)
    $$;
    alter table public.profiles enable row level security;
    create policy read_profiles on public.profiles for select to authenticated using(public.is_admin() or id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
    create policy update_profiles on public.profiles for update to authenticated using(public.is_admin()) with check(public.is_admin());
    grant select,update on public.profiles to authenticated;
  `);
  await db.query("insert into profiles(id,level) values($1,1),($2,2),($3,3)", [admin, content, basic]);
  await db.exec(original);
  await db.query("update profiles set feature_access=jsonb_set(feature_access,'{ai_visibility}','false') where id=$1", [content]);
  await db.exec(upgrade);
}, 30000);
afterEach(async () => { await db?.close(); });

describe("Suite Pricing grant migration and RLS", () => {
  it("preserves existing eligible access and prior section grants", async () => {
    expect(await grants(content)).toEqual({ performance: true, ai_visibility: false, sitecore_pricing: true });
    expect((await grants(basic)).sitecore_pricing).toBe(false);
  });
  it("allows an admin to toggle only pricing without overwriting other grants", async () => {
    await asUser(admin, () => change(content, false));
    expect(await grants(content)).toEqual({ performance: true, ai_visibility: false, sitecore_pricing: false });
    await asUser(admin, () => change(content, true));
    expect((await grants(content)).sitecore_pricing).toBe(true);
  });
  it("preserves revocations when the migration is rerun", async () => {
    await asUser(admin, () => change(content, false)); await db.exec(upgrade); await db.exec(upgrade);
    expect((await grants(content)).sitecore_pricing).toBe(false);
  });
  it.each([content, basic])("blocks feature updates by non-admin %s", async actor => {
    await expect(asUser(actor, () => change(content, true))).rejects.toThrow("Only admins");
    await asUser(actor, () => db.query("update profiles set feature_access=jsonb_set(feature_access,'{sitecore_pricing}','false') where id=$1", [content]));
    expect((await grants(content)).sitecore_pricing).toBe(true);
  });
  it("blocks disabling an admin or enabling pricing for a Basic user", async () => {
    await expect(asUser(admin, () => change(admin, false))).rejects.toThrow("admin access is always enabled");
    await expect(asUser(admin, () => change(basic, true))).rejects.toThrow("role is ineligible");
    expect((await grants(basic)).sitecore_pricing).toBe(false);
  });
  it("defaults new profiles to all grants off", async () => {
    const id = "00000000-0000-4000-8000-000000000004";
    await db.query("insert into profiles(id,level) values($1,2)", [id]);
    expect(await grants(id)).toEqual({ performance: false, ai_visibility: false, sitecore_pricing: false });
  });
  it("keeps the grant RPC unavailable to anonymous callers", async () => {
    const result = await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.set_profile_feature_access(uuid,text,boolean)','execute') allowed");
    expect(result.rows[0].allowed).toBe(false);
  });
});
