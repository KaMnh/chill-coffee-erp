import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadPrefs,
  savePrefs,
  computeNextSort,
  computeNextSortExplicit,
  DEFAULT_PREFS,
  type ListPrefs,
  type StorageLike,
} from "../use-list-preferences";

function createMemoryStorage(): StorageLike & { _data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    _data: data,
    getItem(k: string) {
      return data.has(k) ? (data.get(k) as string) : null;
    },
    setItem(k: string, v: string) {
      data.set(k, v);
    },
  };
}

describe("loadPrefs", () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("returns defaults when storage empty", () => {
    expect(loadPrefs("safe-history", storage)).toEqual(DEFAULT_PREFS);
  });

  it("restores prefs from storage", () => {
    storage.setItem(
      "list-prefs:safe-history",
      JSON.stringify({ search: "milk", sortColumn: "amount", sortDirection: "desc" }),
    );
    expect(loadPrefs("safe-history", storage)).toEqual({
      search: "milk",
      sortColumn: "amount",
      sortDirection: "desc",
    });
  });

  it("falls back to defaults on corrupted JSON", () => {
    storage.setItem("list-prefs:safe-history", "{not json}");
    expect(loadPrefs("safe-history", storage)).toEqual(DEFAULT_PREFS);
  });

  it("normalizes invalid sortDirection to asc", () => {
    storage.setItem(
      "list-prefs:safe-history",
      JSON.stringify({ search: "", sortColumn: "name", sortDirection: "weird" }),
    );
    expect(loadPrefs("safe-history", storage).sortDirection).toBe("asc");
  });

  it("handles non-string search/sortColumn gracefully", () => {
    storage.setItem(
      "list-prefs:safe-history",
      JSON.stringify({ search: 42, sortColumn: 99, sortDirection: "asc" }),
    );
    expect(loadPrefs("safe-history", storage)).toEqual(DEFAULT_PREFS);
  });
});

describe("savePrefs", () => {
  it("writes JSON to storage under list-prefs:<key>", () => {
    const storage = createMemoryStorage();
    const prefs: ListPrefs = { search: "abc", sortColumn: "name", sortDirection: "desc" };
    savePrefs("inventory.stock", prefs, storage);
    const raw = storage.getItem("list-prefs:inventory.stock");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(prefs);
  });

  it("silently no-ops if storage throws (e.g. quota)", () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(() =>
      savePrefs("k", { search: "", sortColumn: null, sortDirection: "asc" }, throwing),
    ).not.toThrow();
  });
});

describe("computeNextSort (toggle helper)", () => {
  it("first click on a column → asc", () => {
    const current: ListPrefs = { search: "", sortColumn: null, sortDirection: "asc" };
    expect(computeNextSort(current, "name")).toEqual({
      search: "",
      sortColumn: "name",
      sortDirection: "asc",
    });
  });

  it("second click on same column → desc", () => {
    const current: ListPrefs = { search: "", sortColumn: "name", sortDirection: "asc" };
    expect(computeNextSort(current, "name")).toEqual({
      search: "",
      sortColumn: "name",
      sortDirection: "desc",
    });
  });

  it("third click on same column → asc again", () => {
    const current: ListPrefs = { search: "", sortColumn: "name", sortDirection: "desc" };
    expect(computeNextSort(current, "name")).toEqual({
      search: "",
      sortColumn: "name",
      sortDirection: "asc",
    });
  });

  it("click different column → asc on new column", () => {
    const current: ListPrefs = { search: "", sortColumn: "name", sortDirection: "desc" };
    expect(computeNextSort(current, "amount")).toEqual({
      search: "",
      sortColumn: "amount",
      sortDirection: "asc",
    });
  });

  it("null clears sort", () => {
    const current: ListPrefs = { search: "x", sortColumn: "name", sortDirection: "desc" };
    expect(computeNextSort(current, null)).toEqual({
      search: "x",
      sortColumn: null,
      sortDirection: "asc",
    });
  });

  it("preserves search field", () => {
    const current: ListPrefs = { search: "milk", sortColumn: null, sortDirection: "asc" };
    expect(computeNextSort(current, "name").search).toBe("milk");
  });
});

describe("computeNextSortExplicit", () => {
  it("sets both column and direction", () => {
    const current: ListPrefs = { search: "", sortColumn: null, sortDirection: "asc" };
    expect(computeNextSortExplicit(current, "amount", "desc")).toEqual({
      search: "",
      sortColumn: "amount",
      sortDirection: "desc",
    });
  });

  it("preserves search field", () => {
    const current: ListPrefs = { search: "milk", sortColumn: "name", sortDirection: "asc" };
    expect(computeNextSortExplicit(current, "amount", "desc").search).toBe("milk");
  });
});
