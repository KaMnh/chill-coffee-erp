import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftsView } from "../shifts-view";

const employeesArgs: unknown[][] = [];
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
// ShiftsView mounts modals (CheckIn/CheckOut/CloseShift…) calling useToast at
// render — stub the provider so they render without <ToastProvider>.
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/queries", () => ({
  useEmployeesQuery: (...a: unknown[]) => { employeesArgs.push(a); return { data: [], isLoading: false, isError: false }; },
  useShiftsQuery: () => ({ data: [], isLoading: false, isError: false }),
  usePayrollQuery: () => ({ data: [], isLoading: false, isError: false }),
  useOpenShiftsQuery: () => ({
    data: [{ id: "s1", employee_id: "e1", business_date: "2026-06-10",
      check_in_at: new Date().toISOString(), check_out_at: null, total_minutes: null,
      status: "checked_in", employee_name: "An", position: null, employee_is_active: false }],
    isLoading: false, refetch: vi.fn(),
  }),
  // CheckOutModal (mounted by ShiftsView) đọc app settings từ cùng barrel.
  useAppSettingsQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
beforeEach(() => { employeesArgs.length = 0; });

describe("ShiftsView — ca đang mở + toggle NV đã ngừng", () => {
  it("render bảng Ca đang mở từ openShiftsQuery", () => {
    wrap(<ShiftsView businessDate="2026-06-28" role="owner" />);
    expect(screen.getByText(/Ca đang mở/i)).toBeInTheDocument();
    expect(screen.getByText("An")).toBeInTheDocument();
  });
  it("tick 'Hiện cả NV đã ngừng' → useEmployeesQuery(includeInactive=true)", () => {
    wrap(<ShiftsView businessDate="2026-06-28" role="owner" />);
    // lần render đầu: includeInactive=false (đối số thứ 3)
    expect(employeesArgs.at(-1)?.[2]).toBe(false);
    fireEvent.click(screen.getByLabelText(/Hiện cả NV đã ngừng/i));
    expect(employeesArgs.at(-1)?.[2]).toBe(true);
  });
});
