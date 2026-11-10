"""Combine canonical sources into the single-file Supabase Dashboard distribution.

This performs text packaging only. It does not build, test, or deploy anything.
"""
from pathlib import Path

performance = Path(__file__).resolve().parents[1]
functions = performance / "supabase" / "functions"
types = (functions / "_shared" / "types.ts").read_text(encoding="utf-8")
analysis = (functions / "_shared" / "analysis.ts").read_text(encoding="utf-8")
analysis = analysis.replace('import type { Brand, Source } from "./types.ts";', "")
worker = (functions / "geo-worker" / "index.ts").read_text(encoding="utf-8")
worker = worker.replace('import { EvidenceValidationError, EXTRACTION_SCHEMA, MappingReviewRequired, normalizeMentions, providerEvidence, record } from "../_shared/analysis.ts";', "")
worker = worker.replace('import type { Brand, Snapshot } from "../_shared/types.ts";', "")
(performance / "deploy" / "geo-worker.dashboard.ts").write_text(
    "// Supabase Dashboard distribution. Paste this entire file into geo-worker/index.ts.\n"
    "// Generated from the worker and _shared sources; contains no credentials.\n"
    + types + "\n" + analysis + "\n" + worker,
    encoding="utf-8",
)
