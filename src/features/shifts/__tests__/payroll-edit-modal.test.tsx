import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PayrollEditModal } from "../payroll-edit-modal";
import type { PayrollRecord } from "@/lib/types";

// ---- Mocks ----
const mutateAsync = vi.fn();
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/mutations/use-shift-mutations", () => ({
  useUpdatePayrollRecord: () => ({ mutateAsync, isPending: false }),
}));

const BASE: PayrollRecord = {
  id: "p1",
  shift_assignment_id: "s1",
  employee_id: "e1",
  business_date: "2026-06-29",
  check_in_at: "2026-06-29T08:00:00+07:00",
  check_out_at: "2026-06-29T12:00:00+07:00",
  total_minutes: 240,
  hourly_rate: 30000,
  base_pay: 120000,
  allowance_amount: 0,
  total_pay: 120000,
  pay_type: "hourly",
  override_pay: null,
  note: null,
  created_at: "2026-06-29T12:00:00+07:00",
  employee_name: "An",
};

function fixedRecord(): PayrollRecord {
  return {
    ...BASE,
    id: "pf1",
    pay_type: "fixed",
    hourly_rate: 0,
    base_pay: 280000,
    override_pay: 280000,
    total_pay: 280000,
    employee_name: "Ba",
  };
}

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
});

describe("PayrollEditModal — fixed vs hourly branch", () => {
  it("fixed: shows 'Lương ngày' prefilled with override_pay, updates total, submits override_pay", async () => {
    render(
      <PayrollEditModal open onOpenChange={() => {}} payroll={fixedRecord()} />
    );

    const dailyInput = screen.getByLabelText(/Lương ngày/i) as HTMLInputElement;
    expect(dailyInput).toBeInTheDocument();
    expect(dailyInput.value).toBe("280.000");

    // Hourly-only rows must NOT be rendered for a fixed record.
    expect(screen.queryByText(/Lương giờ/i)).not.toBeInTheDocument();

    // Change daily pay to 260,000 → total updates.
    fireEvent.change(dailyInput, { target: { value: "260000" } });
    const hero = screen.getByText(/Tổng thực nhận sau chỉnh sửa/i).parentElement!;
    expect(within(hero).getByText("260.000 ₫")).toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: /Lưu chỉnh sửa/i }).closest("form")!);

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.payroll_record_id).toBe("pf1");
    expect(payload.override_pay).toBe(260000);
  });

  it("hourly: shows hours × rate UI, submits without override_pay", async () => {
    render(<PayrollEditModal open onOpenChange={() => {}} payroll={BASE} />);

    // Hourly UI present.
    expect(screen.getByText(/Lương giờ/i)).toBeInTheDocument();
    // No fixed "Lương ngày" input.
    expect(screen.queryByLabelText(/Lương ngày/i)).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: /Lưu chỉnh sửa/i }).closest("form")!);

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.payroll_record_id).toBe("p1");
    expect(payload.override_pay).toBeUndefined();
  });
});
