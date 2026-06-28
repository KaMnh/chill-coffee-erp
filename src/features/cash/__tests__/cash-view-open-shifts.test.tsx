import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CashView } from "../cash-view";

// Host-integration test cho banner "còn ca chưa ra ca" trong màn Chốt két —
// đường người dùng đi khi force-close lúc đóng két. Mock các query/mutation hook
// theo cùng style shifts-view.test.tsx (stub barrel @/hooks/queries).

vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Một ca checked_in để banner xuất hiện.
const OPEN_SHIFT = {
  id: "s1",
  employee_id: "e1",
  business_date: "2026-06-28",
  check_in_at: new Date().toISOString(),
  check_out_at: null,
  total_minutes: null,
  status: "checked_in",
  employee_name: "An",
  position: null,
};

vi.mock("@/hooks/queries", () => ({
  useDashboardQuery: () => ({ data: { total_sales: 0, cash_sales: 0 }, isLoading: false, isError: false }),
  useCashOpeningQuery: () => ({ data: null, isLoading: false, isError: false }),
  useCashCountsQuery: () => ({ data: [], isLoading: false, isFetching: false, isError: false }),
  useShiftsQuery: () => ({ data: [OPEN_SHIFT], isLoading: false, isError: false, refetch: vi.fn() }),
}));

// Stub MỌI mutation hook — các modal con (Opening/EditCount/EditClose/Void) tuy
// đóng (open=false) vẫn gọi hook ở render time, cần stub để không crash. Factory
// bị hoist lên đầu file → định nghĩa stub NGAY TRONG factory (không ref ngoài).
vi.mock("@/hooks/mutations/use-cash-mutations", () => {
  const stub = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useSaveCashCount: stub,
    useFinalizeCashClose: stub,
    useSaveCashDayOpening: stub,
    useUpdateCashCount: stub,
    useEditCashCloseReport: stub,
    useVoidCashCloseReport: stub,
  };
});

vi.mock("@/hooks/use-cash-draft-persistence", () => ({
  useCashDraftPersistence: () => ({ clearDraft: vi.fn() }),
}));

// Các modal con luôn đóng (open=false) trong test này nhưng vẫn mount + gọi
// query hook riêng (vd useSafeBalanceQuery). Stub thành no-op để giữ test tập
// trung vào chuỗi banner (OpenShiftsCloseBanner → OpenShiftsTable → BulkCancel),
// đây mới là phần đang kiểm chứng và được render THẬT.
vi.mock("../opening-cash-modal", () => ({ OpeningCashModal: () => null }));
vi.mock("../edit-cash-count-modal", () => ({ EditCashCountModal: () => null }));
vi.mock("../edit-cash-close-modal", () => ({ EditCashCloseModal: () => null }));
vi.mock("../void-cash-close-modal", () => ({ VoidCashCloseModal: () => null }));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe("CashView — banner ca chưa ra ca (force-close lúc chốt két)", () => {
  it("hiện banner; Xem & đóng lộ bảng; Đóng hết mở modal huỷ", () => {
    wrap(<CashView businessDate="2026-06-28" role="owner" />);

    // 1) Banner cảnh báo còn ca mở.
    expect(screen.getByText(/Còn 1 ca chưa ra ca/i)).toBeInTheDocument();

    // 2) "Xem & đóng" → lộ OpenShiftsTable (nút "Đóng ca" của ca An).
    expect(screen.queryByRole("button", { name: /^Đóng ca$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xem & đóng/i }));
    expect(screen.getByRole("button", { name: /^Đóng ca$/i })).toBeInTheDocument();

    // 3) "Đóng hết (huỷ, không lương)" → mở BulkCancelShiftsModal (field Lý do + nút Huỷ hết).
    fireEvent.click(screen.getByRole("button", { name: /Đóng hết/i }));
    expect(screen.getByLabelText(/Lý do/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Huỷ hết/i })).toBeInTheDocument();
  });
});
