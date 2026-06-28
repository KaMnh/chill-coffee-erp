import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BackupRestoreSection } from "../backup-restore-section";

// BackupRestoreSection gọi useToast + các hook backup (query/mutation) ở render
// time trong các panel con. Stub chúng để test render xác định (giống style
// shifts-view.test.tsx / cash-view-open-shifts.test.tsx).
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/hooks/queries/use-backup-runs-query", () => ({
  // [] + isLoading false → HistoryPanel render "History (chưa có run nào)"
  useBackupRunsQuery: () => ({ data: [], isLoading: false }),
  useBackupRunLogQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/hooks/mutations/use-backup-mutations", () => ({
  useDownloadBackupMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  streamRestore: vi.fn(),
}));

function renderWithProviders(
  role: "owner" | "manager" | "staff_operator" | "employee_viewer"
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BackupRestoreSection role={role} authHeader="Bearer test" />
    </QueryClientProvider>
  );
}

describe("BackupRestoreSection", () => {
  it("non-owner → EmptyState 'Owner only'", () => {
    renderWithProviders("manager");
    expect(screen.getByText(/owner only/i)).toBeInTheDocument();
    // không lộ nút thao tác destructive
    expect(
      screen.queryByRole("button", { name: /download backup/i })
    ).not.toBeInTheDocument();
  });

  it("owner → 3 panel Backup / Restore / History", () => {
    renderWithProviders("owner");
    expect(
      screen.getByRole("button", { name: /download backup/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/chọn file backup/i)).toBeInTheDocument();
    expect(screen.getByText(/history/i)).toBeInTheDocument();
  });

  it("nút Restore disabled khi chưa chọn file", () => {
    renderWithProviders("owner");
    const restoreBtn = screen.getByRole("button", { name: /^restore$/i });
    expect(restoreBtn).toBeDisabled();
  });
});
