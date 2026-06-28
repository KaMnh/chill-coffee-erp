import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpenShiftsCloseBanner } from "../open-shifts-close-banner";

const shifts = [{ id: "s1", business_date: "2026-06-28",
  check_in_at: new Date().toISOString(), employee_name: "An", employee_is_active: true }];

describe("OpenShiftsCloseBanner", () => {
  it("hiện số ca + tên; 'Xem & đóng' lộ bảng; 'Đóng hết' gọi onBulk", () => {
    const onBulk = vi.fn();
    const onClose = vi.fn();
    render(<OpenShiftsCloseBanner shifts={shifts} canManage onClose={onClose} onBulk={onBulk} />);
    expect(screen.getByText(/Còn 1 ca chưa ra ca/i)).toBeInTheDocument();
    // bảng ẩn ban đầu (nút "Đóng ca" của row chưa render)
    expect(screen.queryByRole("button", { name: /^Đóng ca$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xem & đóng/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Đóng ca$/i }));
    expect(onClose).toHaveBeenCalledWith(shifts[0]);
    fireEvent.click(screen.getByRole("button", { name: /Đóng hết/i }));
    expect(onBulk).toHaveBeenCalled();
  });

  it("không phải owner/manager → ẩn nút đóng", () => {
    render(<OpenShiftsCloseBanner shifts={shifts} canManage={false} onClose={vi.fn()} onBulk={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Xem & đóng/i })).not.toBeInTheDocument();
  });
});
