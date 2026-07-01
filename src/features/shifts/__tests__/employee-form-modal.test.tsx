import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmployeeFormModal } from "../employee-form-modal";

// jsdom lacks ResizeObserver, which Radix RadioGroup's Indicator (react-use-size)
// touches on mount. Polyfill it so the pay-type radio renders.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Capture the payload passed to the upsert mutation.
const mutateAsync = vi.fn(() => Promise.resolve({}));

vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/mutations/use-shift-mutations", () => ({
  useUpsertEmployee: () => ({ mutateAsync, isPending: false }),
}));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mutateAsync.mockClear();
});

describe("EmployeeFormModal — pay-type selector + Lương ngày mặc định", () => {
  it("create mode: mặc định hiển thị 'Lương theo giờ'", () => {
    wrap(<EmployeeFormModal open onOpenChange={vi.fn()} employee={null} />);
    expect(screen.getByText("Thêm nhân viên mới")).toBeInTheDocument();
    expect(screen.getByLabelText("Lương theo giờ")).toBeInTheDocument();
    expect(screen.queryByLabelText("Lương ngày mặc định")).not.toBeInTheDocument();
  });

  it("chuyển sang 'Cố định' → ẩn 'Lương theo giờ', hiện 'Lương ngày mặc định'", () => {
    wrap(<EmployeeFormModal open onOpenChange={vi.fn()} employee={null} />);
    fireEvent.click(screen.getByLabelText("Cố định"));
    expect(screen.queryByLabelText("Lương theo giờ")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Lương ngày mặc định")).toBeInTheDocument();
  });

  it("submit fixed → mutation nhận pay_type:'fixed' + default_daily_pay", async () => {
    const onOpenChange = vi.fn();
    wrap(<EmployeeFormModal open onOpenChange={onOpenChange} employee={null} />);

    fireEvent.change(screen.getByLabelText("Tên nhân viên"), {
      target: { value: "NV Cố Định" },
    });
    fireEvent.click(screen.getByLabelText("Cố định"));
    fireEvent.change(screen.getByLabelText("Lương ngày mặc định"), {
      target: { value: "250000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Thêm nhân viên" }));

    // Flush the async submit handler.
    await Promise.resolve();
    await Promise.resolve();

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "NV Cố Định",
        pay_type: "fixed",
        default_daily_pay: 250000,
      })
    );
  });

  it("submit hourly → default_daily_pay = null, pay_type:'hourly'", async () => {
    wrap(<EmployeeFormModal open onOpenChange={vi.fn()} employee={null} />);

    fireEvent.change(screen.getByLabelText("Tên nhân viên"), {
      target: { value: "NV Giờ" },
    });
    fireEvent.change(screen.getByLabelText("Lương theo giờ"), {
      target: { value: "26000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Thêm nhân viên" }));

    await Promise.resolve();
    await Promise.resolve();

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        pay_type: "hourly",
        default_daily_pay: null,
        hourly_rate: 26000,
      })
    );
  });

  it("edit mode: init từ employee.pay_type='fixed' + default_daily_pay", () => {
    wrap(
      <EmployeeFormModal
        open
        onOpenChange={vi.fn()}
        employee={{
          id: "e1",
          code: null,
          name: "Có sẵn",
          position: "Pha chế",
          hourly_rate: 0,
          pay_type: "fixed",
          default_daily_pay: 300000,
          is_active: true,
        }}
      />
    );
    expect(screen.getByText("Sửa thông tin nhân viên")).toBeInTheDocument();
    const dailyInput = screen.getByLabelText("Lương ngày mặc định") as HTMLInputElement;
    expect(dailyInput.value).toBe("300.000");
    expect(screen.queryByLabelText("Lương theo giờ")).not.toBeInTheDocument();
  });
});
