import { describe, it, expect, vi, beforeAll } from "vitest";
import type { UserRole } from "@/lib/types";

/**
 * Regression guard cho bug báo cáo "cấp tài khoản chỉ owner thấy (manager không
 * thấy)". Code hiện cho phép owner + manager cấp tài khoản; bug thực tế gần như
 * chắc do bản deploy cũ. Test này khóa khả năng manager gọi được API quản lý
 * tài khoản (POST /api/users) để không bị siết nhầm về owner-only sau này.
 */

const state = vi.hoisted(() => ({ role: "manager" as string, status: "active" as string }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { role: state.role, status: state.status }, error: null })
        })
      })
    })
  })
}));

import { requireAuth } from "@/lib/supabase/server";
import { MANAGE_USERS_ROLES } from "@/app/api/users/route";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "anon-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-test-key";
});

const ALLOWED: UserRole[] = ["owner", "manager"];
const DENIED: UserRole[] = ["staff_operator", "employee_viewer", "employee_self_service"];

describe("/api/users authorization — cấp tài khoản (owner + manager)", () => {
  it("allowlist = owner + manager", () => {
    expect([...MANAGE_USERS_ROLES].sort()).toEqual([...ALLOWED].sort());
  });

  for (const role of ALLOWED) {
    it(`cho phép ${role} cấp tài khoản`, async () => {
      state.role = role;
      await expect(requireAuth("Bearer t", MANAGE_USERS_ROLES)).resolves.toMatchObject({ role });
    });
  }

  for (const role of DENIED) {
    it(`chặn ${role}`, async () => {
      state.role = role;
      await expect(requireAuth("Bearer t", MANAGE_USERS_ROLES)).rejects.toThrow();
    });
  }
});
