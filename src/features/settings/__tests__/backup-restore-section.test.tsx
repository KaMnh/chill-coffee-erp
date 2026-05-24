// @ts-nocheck — @testing-library/react not yet installed (Phase 6.B)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BackupRestoreSection } from "../backup-restore-section";

function renderWithProviders(role: "owner" | "manager" | "staff_operator" | "employee_viewer") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BackupRestoreSection role={role} authHeader="Bearer test" />
    </QueryClientProvider>
  );
}

describe("BackupRestoreSection", () => {
  it("renders EmptyState for non-owner roles", () => {
    renderWithProviders("manager");
    expect(screen.getByText(/owner only/i)).toBeInTheDocument();
  });

  it("renders 3 panels for owner", () => {
    renderWithProviders("owner");
    expect(screen.getByRole("button", { name: /download backup/i })).toBeInTheDocument();
    expect(screen.getByText(/chọn file backup/i)).toBeInTheDocument();
    expect(screen.getByText(/history/i)).toBeInTheDocument();
  });

  it("disables restore button until file selected", () => {
    renderWithProviders("owner");
    const restoreBtn = screen.getByRole("button", { name: /^restore$/i });
    expect(restoreBtn).toBeDisabled();
  });
});
