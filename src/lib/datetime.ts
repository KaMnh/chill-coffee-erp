/**
 * Datetime helpers — convention: DB session timezone = 'Asia/Ho_Chi_Minh'.
 * Frontend ưu tiên dùng VN local time string (không convert UTC) khi gửi
 * sang backend. PG sẽ tự interpret naive string là VN local.
 *
 * Khi DB nhận `<input type="datetime-local">` value (vd "2026-05-04T05:30")
 * không có TZ marker, PG session VN parse là "5:30 sáng VN" — đúng intent.
 */

/**
 * Convert UTC ISO string từ DB → naive local string cho `<input type="datetime-local">`.
 * Browser tz (VN) tự convert UTC → VN khi `new Date(iso)`. Sau đó subtract
 * offset để output chuỗi naive đúng wall-clock VN.
 *
 * Input vd: "2026-05-04T15:47:00.000Z"
 * Output vd: "2026-05-04T22:47" (= 15:47 UTC + 7h = 22:47 VN)
 */
export function toDatetimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

/**
 * Pass-through `<input type="datetime-local">` value xuống backend.
 * KHÔNG convert sang UTC ISO — DB session VN sẽ tự hiểu naive string là VN
 * local. Vd "2026-05-04T05:30" → PG store như instant `2026-05-04 05:30 VN`
 * (= `2026-05-03 22:30 UTC` dưới hood).
 */
export function fromDatetimeLocal(value: string) {
  return value || null;
}

/**
 * Today's date YYYY-MM-DD in Vietnam wall-clock. Dùng làm default
 * `business_date` filter trong UI / RPC payloads.
 *
 * Trước đây dùng `new Date().toISOString().slice(0, 10)` — nhận UTC date,
 * nửa đêm VN (= 17h UTC) sẽ trả nhầm ngày trước. Helper này dùng
 * `Intl.DateTimeFormat` với timeZone option để extract đúng VN date.
 */
export function todayInVN(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}
