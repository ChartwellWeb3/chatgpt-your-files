export async function fetchPerformance<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/performance?${params}`, { signal, cache: "no-store" });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Your session may have expired. Sign in again to view performance data.");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Performance data could not be loaded.");
  return body;
}
