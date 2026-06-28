import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloseShiftModal } from "../close-shift-modal";

const cancelMock = vi.fn();
const checkoutNowMock = vi.fn();
const checkoutMock = vi.fn();
vi.mock("@/lib/data/shifts", () => ({
  cancelShiftAssignment: (...a: unknown[]) => cancelMock(...a),
  checkOutEmployeeNow: (...a: unknown[]) => checkoutNowMock(...a),
  checkOutEmployee: (...a: unknown[]) => checkoutMock(...a),
}));
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const shift = {
  id: "s1", employee_id: "e1", business_date: "2026-06-28",
  check_in_at: "2026-06-28T01:00:00Z", employee_name: "An", employee_is_active: true,
};

beforeEach(() => { cancelMock.mockReset().mockResolvedValue({ status: "cancelled" });
  checkoutNowMock.mockReset().mockResolvedValue({ employee_name: "An", total_minutes: 60, total_pay: 30000 });
  checkoutMock.mockReset().mockResolvedValue({ total_pay: 30000 }); });

describe("CloseShiftModal", () => {
  it("mode huỷ: bắt buộc lý do mới gọi cancel", async () => {
    wrap(<CloseShiftModal open shift={shift} role="manager" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Huỷ ca/i));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    expect(cancelMock).not.toHaveBeenCalled(); // lý do trống
    fireEvent.change(screen.getByLabelText(/Lý do/i), { target: { value: "NV bỏ về" } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith(expect.anything(), "s1", "NV bỏ về"));
  });

  it("mode trả lương + manager → checkOutEmployeeNow", async () => {
    wrap(<CloseShiftModal open shift={shift} role="manager" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Trả lương/i));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    await waitFor(() => expect(checkoutNowMock).toHaveBeenCalledWith(expect.anything(), "s1"));
  });

  it("mode trả lương + owner → checkOutEmployee (có giờ ra)", async () => {
    wrap(<CloseShiftModal open shift={shift} role="owner" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Trả lương/i));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalled());
    expect(checkoutMock.mock.calls[0][1]).toMatchObject({ shift_assignment_id: "s1", employee_id: "e1" });
  });
});
