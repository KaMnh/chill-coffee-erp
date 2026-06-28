import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BulkCancelShiftsModal } from "../bulk-cancel-shifts-modal";

const cancelMock = vi.fn();
const toastMock = vi.fn();
vi.mock("@/lib/data/shifts", () => ({ cancelShiftAssignment: (...a: unknown[]) => cancelMock(...a) }));
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  cancelMock.mockReset().mockResolvedValue({ status: "cancelled" });
  toastMock.mockReset();
});

describe("BulkCancelShiftsModal", () => {
  it("huỷ hết: gọi cancelShiftAssignment cho từng ca, có lý do", async () => {
    const onOpenChange = vi.fn();
    wrap(<BulkCancelShiftsModal open shiftIds={["a", "b"]} businessDate="2026-06-28" onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hết/i }));
    expect(cancelMock).not.toHaveBeenCalled(); // chưa có lý do
    fireEvent.change(screen.getByLabelText(/Lý do/i), { target: { value: "Hết ngày" } });
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hết/i }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(2));
    expect(cancelMock).toHaveBeenCalledWith(expect.anything(), "a", "Hết ngày");
    // Thành công hết → đóng modal.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("1 ca lỗi (không phải 'đã đóng') → vẫn gọi đủ 2 ca, KHÔNG đóng modal, vẫn refresh", async () => {
    cancelMock
      .mockResolvedValueOnce({ status: "cancelled" })
      .mockRejectedValueOnce(new Error("Lỗi mạng tạm thời"));
    const onOpenChange = vi.fn();
    const onDone = vi.fn();
    wrap(
      <BulkCancelShiftsModal
        open
        shiftIds={["a", "b"]}
        businessDate="2026-06-28"
        onOpenChange={onOpenChange}
        onDone={onDone}
      />
    );
    fireEvent.change(screen.getByLabelText(/Lý do/i), { target: { value: "Hết ngày" } });
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hết/i }));
    // Không abort: cả 2 ca đều được gọi.
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(2));
    // onDone vẫn chạy để parent lấy danh sách mới.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Có lỗi → modal KHÔNG đóng (không gọi onOpenChange(false)).
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Toast lỗi được hiện, không phải toast thành công.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ semantic: "danger" })
    );
  });
});
