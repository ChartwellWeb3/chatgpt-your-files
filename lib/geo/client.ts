export async function geoFetch<T>(params: Record<string, string | number | boolean> = {}, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  const response = await fetch(`/api/geo?${query}`, { signal, cache: "no-store" });
  return read<T>(response);
}
export async function geoWrite<T>(body: Record<string, unknown>, ai = false): Promise<T> {
  const response = await fetch(ai ? "/api/geo/ai" : "/api/geo", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return read<T>(response);
}
async function read<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || (response.status === 401 ? "Please sign in again." : "GEO data could not be loaded.")), { runId: data.runId });
  return data as T;
}
export const percentage = (value: number | null | undefined) => value == null ? "—" : `${(Number(value) * 100).toFixed(1)}%`;
export const safeUrl = (value: string) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
};
export function initialDates() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const from = new Date(`${today}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: today };
}
