import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BulkCancelShiftsModal } from "../bulk-cancel-shifts-modal";

const cancelMock = vi.fn();
vi.mock("@/lib/data/shifts", () => ({ cancelShiftAssignment: (...a: unknown[]) => cancelMock(...a) }));
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
beforeEach(() => cancelMock.mockReset().mockResolvedValue({ status: "cancelled" }));

describe("BulkCancelShiftsModal", () => {
  it("huỷ hết: gọi cancelShiftAssignment cho từng ca, có lý do", async () => {
    wrap(<BulkCancelShiftsModal open shiftIds={["a", "b"]} businessDate="2026-06-28" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hết/i }));
    expect(cancelMock).not.toHaveBeenCalled(); // chưa có lý do
    fireEvent.change(screen.getByLabelText(/Lý do/i), { target: { value: "Hết ngày" } });
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hết/i }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(2));
    expect(cancelMock).toHaveBeenCalledWith(expect.anything(), "a", "Hết ngày");
  });
});
