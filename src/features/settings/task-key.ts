/**
 * Slugify a Vietnamese label into a stable task key for handover defaults.
 *
 * Strips diacritics (NFD + combining mark removal), maps Vietnamese đ → d,
 * lowercases, replaces non-alphanum with underscores, trims leading/trailing
 * underscores, and caps at 40 chars. If the result is empty (label was all
 * special chars), returns "task".
 *
 * Optional `existingKeys` set: if the slug collides, appends "_2", "_3", ...
 * until unique.
 *
 * Examples:
 *   "Đếm doanh thu cuối ngày" → "dem_doanh_thu_cuoi_ngay"
 *   "Khóa két - giao ca"      → "khoa_ket_giao_ca"
 *   ""                         → "task"
 *   "Đếm" with {"dem"} present → "dem_2"
 */
export function slugifyTaskKey(
  label: string,
  existingKeys?: ReadonlySet<string>
): string {
  const base =
    label
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")    // strip combining marks (diacritics)
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "task";

  if (!existingKeys || !existingKeys.has(base)) return base;

  let n = 2;
  while (existingKeys.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
