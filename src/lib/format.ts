export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function formatVND(value: number | null | undefined) {
  return `${formatNumber(value)} ₫`;
}

/**
 * Compact VND format cho mobile metrics bar (rất ít space).
 * - >= 1.000.000 → "1.7M" (1 decimal place, dấu chấm)
 * - >= 1.000     → "185k" (làm tròn integer)
 * - else         → "0" hoặc "500"
 *
 * Examples:
 *   formatVNDCompact(1721000) → "1.7M"
 *   formatVNDCompact(185000)  → "185k"
 *   formatVNDCompact(500)     → "500"
 *   formatVNDCompact(0)       → "0"
 */
export function formatVNDCompact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    // toFixed(1) cho 1.7M; nếu integer (vd 2.0M) bỏ ".0" thành "2M"
    const formatted = millions.toFixed(1).replace(/\.0$/, "");
    return `${sign}${formatted}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

/**
 * @deprecated Dùng `todayInVN()` từ `@/lib/datetime` — function này trả UTC
 * date, có thể off-by-1-day với VN sau 17h UTC (= 0h sáng VN). Giữ wrapper
 * để tránh break callsite cũ trong khi migrate.
 */
export function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Chưa có";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false
  }).format(new Date(value));
}

export function formatTime(value: string | null | undefined) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function durationLabel(minutes: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(minutes ?? 0)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")} giờ`;
}

export function moneyFromInput(value: string) {
  return Number(value.replace(/[^0-9-]/g, "")) || 0;
}
