import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CheckOutModal } from "../check-out-modal";
import type { Employee, ShiftAssignment } from "@/lib/types";

// Capture check-out payloads submitted via useCheckOut.
const mutateAsync = vi.fn();

vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/queries", () => ({
  // Fixed threshold_hours high so allowance never auto-fills in these tests.
  useAppSettingsQuery: () => ({
    data: { shift_bonus_config: { threshold_hours: 999, bonus_amount: 10000 } },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/mutations/use-shift-mutations", () => ({
  useCheckOut: () => ({ mutateAsync, isPending: false }),
}));

const CHECK_IN = "2026-06-28T08:00:00.000Z";

const shift: ShiftAssignment = {
  id: "s1",
  employee_id: "e1",
  business_date: "2026-06-28",
  check_in_at: CHECK_IN,
  check_out_at: null,
  total_minutes: null,
  status: "checked_in",
};

const hourlyEmployee: Employee = {
  id: "e1",
  code: null,
  name: "NV Hourly",
  position: null,
  hourly_rate: 30000,
  pay_type: "hourly",
  default_daily_pay: null,
  is_active: true,
};

const fixedEmployee: Employee = {
  id: "e1",
  code: null,
  name: "NV Fixed",
  position: null,
  hourly_rate: 0,
  pay_type: "fixed",
  default_daily_pay: 250000,
  is_active: true,
};

function renderModal(employee: Employee) {
  return render(
    <CheckOutModal
      open
      onOpenChange={vi.fn()}
      shift={shift}
      employee={employee}
      businessDate="2026-06-28"
    />
  );
}

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
});

describe("CheckOutModal — fixed vs hourly", () => {
  it("fixed NV: 'Lương ngày' prefilled từ default_daily_pay, total = daily + allowance, payload có override_pay", async () => {
    renderModal(fixedEmployee);

    // "Lương ngày" input prefilled với default_daily_pay = 250000 (định dạng vi-VN).
    const dailyInput = screen.getByLabelText("Lương ngày") as HTMLInputElement;
    expect(dailyInput.value).toBe("250.000");

    // Hourly-only rows KHÔNG hiển thị cho NV fixed.
    expect(screen.queryByText("Tổng giờ")).not.toBeInTheDocument();
    expect(screen.queryByText("Lương giờ")).not.toBeInTheDocument();

    // Đổi lương ngày → 300000, allowance → 20000 ⇒ total 320000.
    fireEvent.change(dailyInput, { target: { value: "300000" } });
    fireEvent.change(screen.getByLabelText("Bồi dưỡng"), {
      target: { value: "20000" },
    });
    expect(screen.getByText("320.000 ₫")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Xác nhận ra ca/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      shift_assignment_id: "s1",
      employee_id: "e1",
      override_pay: 300000,
      allowance_amount: 20000,
    });
  });

  it("hourly NV: UI giờ×rate hiển thị, submit KHÔNG kèm override_pay", async () => {
    renderModal(hourlyEmployee);

    // Hourly rows hiển thị; KHÔNG có "Lương ngày".
    expect(screen.getByText("Tổng giờ")).toBeInTheDocument();
    expect(screen.getByText("Lương giờ")).toBeInTheDocument();
    expect(screen.queryByLabelText("Lương ngày")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Xác nhận ra ca/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      shift_assignment_id: "s1",
      employee_id: "e1",
    });
    expect(payload).not.toHaveProperty("override_pay");
  });
});
