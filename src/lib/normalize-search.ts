/**
 * Diacritic-insensitive search helpers (searchable dropdown feature).
 *
 * Vietnamese-aware: `đ`/`Đ` are mapped by hand BEFORE NFD because Unicode
 * NFD does not decompose `đ` into `d` + a combining mark. After that, NFD
 * splits the remaining accented letters into base + combining marks, which
 * we strip. Matching is plain substring on the normalized strings.
 */

// U+0300–U+036F: combining diacritical marks that NFD separates out.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .trim();
}

export function matchesSearch(haystack: string, query: string): boolean {
  return normalizeForSearch(haystack).includes(normalizeForSearch(query));
}
