"use client";

/**
 * Client helpers for the manual KiotViet Excel import (owner-only).
 * Mirrors the plain-fetch style of use-backup-mutations.ts. The same File is
 * sent twice (preview then commit) — stateless, no server temp file.
 */

export interface ExcelImportResult {
  status: string;
  committed: boolean;
  would_update: number;
  would_insert: number;
  date_corrections: Array<{ invoice_code: string; from: string | null; to: string }>;
  orders: number;
  items: number;
  payments: number;
  run_id: string | null;
  meta: { row_count: number; invoice_count: number; skipped_count: number };
}

async function postImport(authHeader: string, file: File, commit: boolean): Promise<ExcelImportResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("commit", commit ? "true" : "false");
  const res = await fetch("/api/kiotviet/import-excel", {
    method: "POST",
    headers: { Authorization: authHeader },
    body: fd,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && (body.error as string)) || `Import lỗi (HTTP ${res.status}).`);
  }
  return body as ExcelImportResult;
}

/** Dry-run: counts + date corrections, writes nothing. */
export const previewExcelImport = (authHeader: string, file: File) => postImport(authHeader, file, false);

/** Commit: upsert by invoice_code + backfill. */
export const commitExcelImport = (authHeader: string, file: File) => postImport(authHeader, file, true);
