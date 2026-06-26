import { describe, it, expect } from "vitest";
import {
  mapRepointErrorStatus,
  validateRepointBody,
  isSelfRepoint
} from "@/lib/repoint-account";

describe("mapRepointErrorStatus", () => {
  it("23505 → 409", () => expect(mapRepointErrorStatus("23505")).toBe(409));
  it("P0002 → 404", () => expect(mapRepointErrorStatus("P0002")).toBe(404));
  it("P0001 → 400", () => expect(mapRepointErrorStatus("P0001")).toBe(400));
  it("undefined → 400", () => expect(mapRepointErrorStatus(undefined)).toBe(400));
});

describe("validateRepointBody", () => {
  const T = "11111111-1111-1111-1111-111111111111";
  const S = "22222222-2222-2222-2222-222222222222";
  it("nhận uuid hợp lệ", () => {
    expect(validateRepointBody({ target_employee_id: T, source_employee_id: S })).toEqual({
      ok: true,
      value: { target_employee_id: T, source_employee_id: S }
    });
  });
  it("thiếu target → lỗi", () =>
    expect(validateRepointBody({ source_employee_id: S }).ok).toBe(false));
  it("thiếu source → lỗi", () =>
    expect(validateRepointBody({ target_employee_id: T }).ok).toBe(false));
  it("không phải uuid → lỗi", () =>
    expect(validateRepointBody({ target_employee_id: "nope", source_employee_id: S }).ok).toBe(false));
  it("không phải object → lỗi", () => expect(validateRepointBody(null).ok).toBe(false));
});

describe("isSelfRepoint", () => {
  it("id bằng nhau → true", () => expect(isSelfRepoint("u1", "u1")).toBe(true));
  it("id khác → false", () => expect(isSelfRepoint("u1", "u2")).toBe(false));
});
