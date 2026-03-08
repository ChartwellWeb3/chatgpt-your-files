import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("GET /api/sitecore/residence-selector", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env = { ...envBackup };
    delete process.env.SITECORE_GRAPHQL_ENDPOINT;
    delete process.env.SITECORE_RESIDENCE_DATASOURCE;
    delete process.env.SITECORE_EDGE_CONTEXT_ID;
    delete process.env.SITECORE_GQL_TOKEN;
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllGlobals();
  });

  it("returns 500 if endpoint is missing", async () => {
    const { GET } = await import("@/app/api/sitecore/residence-selector/route");

    const res = await GET(new Request("http://localhost/api/sitecore/residence-selector?language=en"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "Missing SITECORE_GRAPHQL_ENDPOINT" });
  });

  it("returns 500 if datasource is missing", async () => {
    process.env.SITECORE_GRAPHQL_ENDPOINT = "https://sitecore/graphql";

    const { GET } = await import("@/app/api/sitecore/residence-selector/route");

    const res = await GET(new Request("http://localhost/api/sitecore/residence-selector?language=en"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "Missing SITECORE_RESIDENCE_DATASOURCE" });
  });

  it("proxies successful payloads and defaults language to fr", async () => {
    process.env.SITECORE_GRAPHQL_ENDPOINT = "https://sitecore/graphql";
    process.env.SITECORE_RESIDENCE_DATASOURCE = "/sitecore/content/residences";
    process.env.SITECORE_EDGE_CONTEXT_ID = "edge-key";
    process.env.SITECORE_GQL_TOKEN = "gql-token";

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { residences: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { GET } = await import("@/app/api/sitecore/residence-selector/route");

    const res = await GET(new Request("http://localhost/api/sitecore/residence-selector?language=es"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, payload: { data: { residences: [] } } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body));

    expect(body.variables).toMatchObject({
      datasource: "/sitecore/content/residences",
      language: "fr",
    });
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-GQL-TOKEN": "gql-token",
      sc_apikey: "edge-key",
    });
  });

  it("returns 502 with payload when upstream is non-200", async () => {
    process.env.SITECORE_GRAPHQL_ENDPOINT = "https://sitecore/graphql";
    process.env.SITECORE_RESIDENCE_DATASOURCE = "/sitecore/content/residences";

    fetchMock.mockResolvedValue(new Response("upstream error", { status: 503 }));

    const { GET } = await import("@/app/api/sitecore/residence-selector/route");

    const res = await GET(new Request("http://localhost/api/sitecore/residence-selector?language=en"));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.ok).toBe(false);
    expect(json.status).toBe(503);
    expect(json.payload).toEqual({ raw: "upstream error" });
  });
});
