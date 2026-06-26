/**
 * Pure helpers cho route /api/users/[id]/repoint — KHÔNG import server-only
 * (getServiceRoleClient, next/headers…) để Vitest chạy được.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map SQLSTATE từ RPC → HTTP status (khớp PATCH map '23505'). */
export function mapRepointErrorStatus(code: string | undefined): number {
  if (code === "23505") return 409;
  if (code === "P0002") return 404;
  return 400;
}

export type RepointBody = { target_employee_id: string; source_employee_id: string };

/** Validate body POST repoint: 2 field uuid bắt buộc. */
export function validateRepointBody(
  body: unknown
): { ok: true; value: RepointBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body không hợp lệ." };
  }
  const b = body as Record<string, unknown>;
  const target = typeof b.target_employee_id === "string" ? b.target_employee_id.trim() : "";
  const source = typeof b.source_employee_id === "string" ? b.source_employee_id.trim() : "";
  if (!UUID_RE.test(target)) return { ok: false, error: "Thiếu hoặc sai nhân viên đích." };
  if (!UUID_RE.test(source)) return { ok: false, error: "Thiếu hoặc sai nhân viên nguồn." };
  return { ok: true, value: { target_employee_id: target, source_employee_id: source } };
}

/** Chặn re-point chính tài khoản đang đăng nhập. */
export function isSelfRepoint(callerUserId: string, targetAuthUserId: string): boolean {
  return callerUserId === targetAuthUserId;
}
