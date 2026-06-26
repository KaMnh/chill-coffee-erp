import { describe, it, expect, vi, beforeAll } from "vitest";
import type { UserRole } from "@/lib/types";

/**
 * Phase 1 — self-checkin mở cho cấp dưới owner.
 *
 * Codex finding: pgTAP trên check_in_self KHÔNG chứng minh được role-widening vì
 * RPC không kiểm role. Cổng thật là `requireAuth(authz, CHECKIN_ALLOWED_ROLES)`
 * trong route. Test này chạy requireAuth THẬT đối chiếu với allowlist THẬT của
 * route, chỉ mock I/O Supabase (auth.getUser + employee_accounts).
 */

// Mutable state the hoisted mock reads — what employee_accounts returns this test.
const state = vi.hoisted(() => ({ role: "employee_self_service" as string, status: "active" as string }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null })
    },
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
import { CHECKIN_ALLOWED_ROLES } from "@/lib/api-roles";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "anon-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-test-key";
});

const ALLOWED: UserRole[] = ["employee_self_service", "staff_operator", "manager"];
const DENIED: UserRole[] = ["owner", "employee_viewer"];

describe("/api/checkin authorization — self-checkin cho mọi role dưới owner", () => {
  it("allowlist = employee_self_service + staff_operator + manager (loại owner & viewer)", () => {
    expect([...CHECKIN_ALLOWED_ROLES].sort()).toEqual([...ALLOWED].sort());
  });

  for (const role of ALLOWED) {
    it(`cho phép ${role} qua cổng auth`, async () => {
      state.role = role;
      await expect(requireAuth("Bearer t", CHECKIN_ALLOWED_ROLES)).resolves.toMatchObject({ role });
    });
  }

  for (const role of DENIED) {
    it(`chặn ${role} (không trong allowlist)`, async () => {
      state.role = role;
      await expect(requireAuth("Bearer t", CHECKIN_ALLOWED_ROLES)).rejects.toThrow();
    });
  }
});
