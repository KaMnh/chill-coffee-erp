import type { UserRole } from "@/lib/types";

/**
 * Allowlist roles cho các API route. Tách khỏi `route.ts` vì Next.js App Router
 * chỉ cho phép route file export các "route field" hợp lệ (HTTP methods + config)
 * — export hằng khác sẽ làm `next build` fail. Để ở đây để vừa dùng trong route
 * vừa test trực tiếp được.
 */

/**
 * Self-check-in (Attendance RBAC Phase 1): mọi cấp DƯỚI owner — manager,
 * staff_operator, employee_self_service. Owner KHÔNG tự chấm công (vận hành/sửa giờ).
 */
export const CHECKIN_ALLOWED_ROLES: UserRole[] = ["employee_self_service", "staff_operator", "manager"];

/** Quản lý/cấp tài khoản (POST/PATCH/DELETE /api/users…): owner + manager. */
export const MANAGE_USERS_ROLES: UserRole[] = ["owner", "manager"];
