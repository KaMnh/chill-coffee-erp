"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ----- Pure types + helpers (testable without DOM/React) ---------------

export interface ListPrefs {
  search: string;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
}

export const DEFAULT_PREFS: ListPrefs = {
  search: "",
  sortColumn: null,
  sortDirection: "asc",
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Minimal storage interface — accepts both real `localStorage` and a test
 * memory-backed double. Keeps pure helpers free of `window` globals.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(listKey: string): string {
  return `list-prefs:${listKey}`;
}

export function loadPrefs(listKey: string, storage: StorageLike): ListPrefs {
  try {
    const raw = storage.getItem(storageKey(listKey));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.search !== "string") return DEFAULT_PREFS;
    if (parsed.sortColumn !== null && typeof parsed.sortColumn !== "string") {
      return DEFAULT_PREFS;
    }
    return {
      search: parsed.search,
      sortColumn: (parsed.sortColumn as string | null) ?? null,
      sortDirection: parsed.sortDirection === "desc" ? "desc" : "asc",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(
  listKey: string,
  prefs: ListPrefs,
  storage: StorageLike,
): void {
  try {
    storage.setItem(storageKey(listKey), JSON.stringify(prefs));
  } catch {
    /* quota exceeded / serialization error — silent */
  }
}

/**
 * Pure sort-toggle helper. Mirrors the spec:
 *   - click same column → flip direction
 *   - click new column → reset to asc
 *   - column=null → clear
 */
export function computeNextSort(
  current: ListPrefs,
  column: string | null,
): ListPrefs {
  if (column === null) {
    return { ...current, sortColumn: null, sortDirection: "asc" };
  }
  if (current.sortColumn === column) {
    return {
      ...current,
      sortDirection: current.sortDirection === "asc" ? "desc" : "asc",
    };
  }
  return { ...current, sortColumn: column, sortDirection: "asc" };
}

/** Pure setter: both column + direction in one call (used by Sort dropdowns). */
export function computeNextSortExplicit(
  current: ListPrefs,
  column: string,
  direction: "asc" | "desc",
): ListPrefs {
  return { ...current, sortColumn: column, sortDirection: direction };
}

// ----- React hook (thin wrapper around pure helpers) -------------------

export interface UseListPreferencesReturn {
  prefs: ListPrefs;
  setSearch(value: string): void;
  setSort(column: string | null): void;
  setSortExplicit(column: string, direction: "asc" | "desc"): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

/**
 * Manage per-list search + sort state with localStorage persistence.
 * Search writes debounced {@link SEARCH_DEBOUNCE_MS}ms; sort writes immediate.
 */
export function useListPreferences(listKey: string): UseListPreferencesReturn {
  const [prefs, setPrefs] = useState<ListPrefs>(() => {
    const storage = getBrowserStorage();
    return storage ? loadPrefs(listKey, storage) : DEFAULT_PREFS;
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  const setSearch = useCallback(
    (value: string) => {
      setPrefs((current) => {
        const next: ListPrefs = { ...current, search: value };
        if (debounceRef.current !== null) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const storage = getBrowserStorage();
          if (storage) savePrefs(listKey, next, storage);
          debounceRef.current = null;
        }, SEARCH_DEBOUNCE_MS);
        return next;
      });
    },
    [listKey],
  );

  const setSort = useCallback(
    (column: string | null) => {
      setPrefs((current) => {
        const next = computeNextSort(current, column);
        const storage = getBrowserStorage();
        if (storage) savePrefs(listKey, next, storage);
        return next;
      });
    },
    [listKey],
  );

  const setSortExplicit = useCallback(
    (column: string, direction: "asc" | "desc") => {
      setPrefs((current) => {
        const next = computeNextSortExplicit(current, column, direction);
        const storage = getBrowserStorage();
        if (storage) savePrefs(listKey, next, storage);
        return next;
      });
    },
    [listKey],
  );

  return { prefs, setSearch, setSort, setSortExplicit };
}
