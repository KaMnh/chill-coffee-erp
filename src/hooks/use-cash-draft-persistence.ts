"use client";

import { useCallback, useEffect, useRef } from "react";

const DRAFT_KEY_PREFIX = "cash-draft:";

export interface CashDraftSnapshot {
  counts: Record<string, number>;
  bankTransfer: string;
  note: string;
  leaveForNextDay: string;
  isManualPos: boolean;
  manualPosTotal: string;
  manualPosCash: string;
  manualPosNonCash: string;
}

export interface CashDraftSetters {
  setCounts: (v: Record<string, number>) => void;
  setBankTransfer: (v: string) => void;
  setNote: (v: string) => void;
  setLeaveForNextDay: (v: string) => void;
  setIsManualPos: (v: boolean) => void;
  setManualPosTotal: (v: string) => void;
  setManualPosCash: (v: string) => void;
  setManualPosNonCash: (v: string) => void;
}

const EMPTY_DRAFT: CashDraftSnapshot = {
  counts: {},
  bankTransfer: "",
  note: "",
  leaveForNextDay: "",
  isManualPos: false,
  manualPosTotal: "",
  manualPosCash: "",
  manualPosNonCash: "",
};

function isValidDraft(value: unknown): value is CashDraftSnapshot {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  if (
    typeof d.bankTransfer !== "string" ||
    typeof d.note !== "string" ||
    typeof d.leaveForNextDay !== "string" ||
    typeof d.isManualPos !== "boolean" ||
    typeof d.manualPosTotal !== "string" ||
    typeof d.manualPosCash !== "string" ||
    typeof d.manualPosNonCash !== "string"
  ) {
    return false;
  }
  if (!d.counts || typeof d.counts !== "object" || Array.isArray(d.counts)) return false;
  for (const v of Object.values(d.counts as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return true;
}

function isEmptyDraft(d: CashDraftSnapshot): boolean {
  return (
    Object.keys(d.counts).length === 0 &&
    d.bankTransfer === "" &&
    d.note === "" &&
    d.leaveForNextDay === "" &&
    d.isManualPos === false &&
    d.manualPosTotal === "" &&
    d.manualPosCash === "" &&
    d.manualPosNonCash === ""
  );
}

/**
 * Mirror CashView form state into localStorage so unsaved entries
 * survive a page refresh. Storage is per-businessDate; old drafts
 * are not auto-cleaned (no TTL — YAGNI). React state remains the
 * source of truth; this hook is a write-only mirror that restores
 * on mount or businessDate change.
 *
 * Failure modes (quota, disabled storage, schema drift) silently
 * degrade — no errors surfaced to UI, behavior falls back to the
 * pre-feature state of "no persistence".
 *
 * Coordination between the two effects:
 *   - `restoredRef` gates persist until restore has run at all.
 *   - `justRestoredRef` makes persist skip the run IMMEDIATELY after a
 *     restore. That run's closure still has the pre-restore (empty)
 *     snapshot — if we wrote/removed based on it, we'd clobber the
 *     value we just loaded. Strict Mode's effect double-fire makes
 *     this critical: the second restore re-reads localStorage, and a
 *     clobber between the two reads leaves state permanently empty.
 *   - `snapshotRef` lets the persist body read the LATEST snapshot
 *     instead of the (potentially stale) closure when it does run.
 *
 * On `businessDate` change with no draft for the new date, all 8
 * fields reset to EMPTY_DRAFT so state doesn't leak across dates.
 */
export function useCashDraftPersistence(
  businessDate: string,
  snapshot: CashDraftSnapshot,
  setters: CashDraftSetters,
): { clearDraft: () => void } {
  const restoredRef = useRef(false);
  const justRestoredRef = useRef(false);
  const settersRef = useRef(setters);
  const snapshotRef = useRef(snapshot);
  settersRef.current = setters;
  snapshotRef.current = snapshot;

  // Restore on mount and on businessDate change.
  useEffect(() => {
    restoredRef.current = false;
    if (typeof window === "undefined") {
      restoredRef.current = true;
      return;
    }
    let restored: CashDraftSnapshot = EMPTY_DRAFT;
    try {
      const raw = window.localStorage.getItem(`${DRAFT_KEY_PREFIX}${businessDate}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidDraft(parsed)) {
          restored = parsed;
        }
      }
    } catch {
      // Silent — fall back to EMPTY_DRAFT.
    }
    const s = settersRef.current;
    s.setCounts(restored.counts);
    s.setBankTransfer(restored.bankTransfer);
    s.setNote(restored.note);
    s.setLeaveForNextDay(restored.leaveForNextDay);
    s.setIsManualPos(restored.isManualPos);
    s.setManualPosTotal(restored.manualPosTotal);
    s.setManualPosCash(restored.manualPosCash);
    s.setManualPosNonCash(restored.manualPosNonCash);
    restoredRef.current = true;
    justRestoredRef.current = true;
  }, [businessDate]);

  // Persist on every snapshot change. The very first run after each restore
  // is skipped because its closure still holds the pre-restore (empty)
  // snapshot; the next run sees the restored values via snapshotRef.
  useEffect(() => {
    if (!restoredRef.current) return;
    if (justRestoredRef.current) {
      justRestoredRef.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    const current = snapshotRef.current;
    const key = `${DRAFT_KEY_PREFIX}${businessDate}`;
    try {
      if (isEmptyDraft(current)) {
        // Remove rather than write an empty draft — keeps storage clean
        // and prevents stale data from restoring if user clears all fields.
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(current));
      }
    } catch {
      // Silent — quota exceeded or storage disabled.
    }
  }, [
    businessDate,
    snapshot.counts,
    snapshot.bankTransfer,
    snapshot.note,
    snapshot.leaveForNextDay,
    snapshot.isManualPos,
    snapshot.manualPosTotal,
    snapshot.manualPosCash,
    snapshot.manualPosNonCash,
  ]);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(`${DRAFT_KEY_PREFIX}${businessDate}`);
    } catch {
      // Silent.
    }
  }, [businessDate]);

  return { clearDraft };
}
