import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpenShiftsTable, type OpenShiftRow } from "../open-shifts-table";

const base: OpenShiftRow = {
  id: "s1", business_date: "2026-06-10", check_in_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  employee_name: "An", employee_is_active: true,
};

describe("OpenShiftsTable", () => {
  it("hiện tên NV + nút Đóng ca, gọi onClose", () => {
    const onClose = vi.fn();
    render(<OpenShiftsTable shifts={[base]} onClose={onClose} />);
    expect(screen.getByText("An")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Đóng ca/i }));
    expect(onClose).toHaveBeenCalledWith(base);
  });

  it("employee_name null → nhãn 'NV đã ngừng'", () => {
    render(<OpenShiftsTable shifts={[{ ...base, employee_name: null }]} onClose={vi.fn()} />);
    expect(screen.getByText(/NV đã ngừng/i)).toBeInTheDocument();
  });

  it("employee_is_active=false → chip 'Đã ngừng'", () => {
    render(<OpenShiftsTable shifts={[{ ...base, employee_is_active: false }]} onClose={vi.fn()} />);
    expect(screen.getByText(/Đã ngừng/i)).toBeInTheDocument();
  });

  it("đã làm > 12 giờ → cờ 'Quá hạn'", () => {
    const old = { ...base, check_in_at: new Date(Date.now() - 13 * 60 * 60_000).toISOString() };
    render(<OpenShiftsTable shifts={[old]} onClose={vi.fn()} />);
    expect(screen.getByText(/Quá hạn/i)).toBeInTheDocument();
  });

  it("rỗng → empty state", () => {
    render(<OpenShiftsTable shifts={[]} onClose={vi.fn()} />);
    expect(screen.getByText(/Không có ca đang mở/i)).toBeInTheDocument();
  });
});
