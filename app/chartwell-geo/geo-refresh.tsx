"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";

const RefreshContext = createContext({ visible: true, monitoring: false, tests: false });
export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update(); document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
export function GeoRefreshProvider({ children, ...value }: { children: ReactNode; visible: boolean; monitoring: boolean; tests: boolean }) {
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}
export function useGeoRefresh(kind: "monitoring" | "tests" | "any" = "monitoring", activeInterval = 15000) {
  const state = useContext(RefreshContext);
  const active = kind === "any" ? state.monitoring || state.tests : state[kind];
  return { refetchInterval: state.visible ? active ? activeInterval : 60000 : false as const,
    refetchIntervalInBackground: false, refetchOnWindowFocus: true, staleTime: 15000 };
}

export async function invalidateGeoViews(client: QueryClient, environment: string, views: string[]) {
  await Promise.all(views.map(view => client.invalidateQueries({ queryKey: ["geo", environment, view] })));
}
export function invalidateGeoAction(client: QueryClient, environment: string, action: string) {
  const views: Record<string, string[]> = {
    createBenchmark: ["catalogs", "live", "schedule"],
    saveQuestion: ["questions", "live"], questionStatus: ["questions", "live"],
    questionSchedule: ["questions", "live"], discover: ["questions", "live"],
    schedule: ["live", "schedule"], test: ["tests", "live"],
    run: ["runs", "batches", "live"], runNow: ["runs", "batches", "live"], runAll: ["runs", "batches", "live"],
    retryBatch: ["runs", "batches", "evidence", "mappingReviews", "live", "overview"],
    cancelBatch: ["runs", "batches", "evidence", "mappingReviews", "live", "overview"],
    opportunities: ["opportunities"], insightStatus: ["opportunities"],
  };
  return invalidateGeoViews(client, environment, views[action] || []);
}
export function invalidateGeoCompletion(client: QueryClient, environment: string, reporting: boolean) {
  return invalidateGeoViews(client, environment, reporting
    ? ["overview", "questions", "competitors", "sources", "opportunities", "validation", "mappingReviews", "runs", "batches", "schedule", "live"]
    : ["tests", "mappingReviews", "live"]);
}
