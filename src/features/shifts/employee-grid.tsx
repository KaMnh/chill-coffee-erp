"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Employee, ShiftAssignment } from "@/lib/types";

interface EmployeeGridProps {
  employees: ReadonlyArray<Employee>;
  /** Map of employee_id -> most-recent shift today (first-wins). */
  shiftByEmployee: ReadonlyMap<string, ShiftAssignment>;
  /** owner/manager: quản lý hồ sơ NV (Sửa, Cấp tài khoản). */
  canManage: boolean;
  /** Phase 2b: chỉ owner mới chấm công thủ công (Vào ca/Ra ca). */
  isOwner: boolean;
  /** employee_ids that already have a login account (owner/manager only). */
  accountedEmployeeIds: ReadonlySet<string>;
  onCheckIn(employee: Employee): void;
  onCheckOut(shift: ShiftAssignment): void;
  onEditEmployee(employee: Employee): void;
  /** Open the "Cấp tài khoản" modal for an employee without a login. */
  onGrantAccount(employee: Employee): void;
}

function statusBadge(status: ShiftAssignment["status"] | undefined) {
  if (status === "checked_in") {
    return <Badge variant="soft" semantic="success">Đang trong ca</Badge>;
  }
  if (status === "checked_out") {
    return <Badge variant="soft" semantic="neutral">Đã ra ca</Badge>;
  }
  return <Badge variant="soft" semantic="warning">Chưa vào</Badge>;
}

/**
 * 2-col grid of employees: "Đang làm việc" (checked-in) on left,
 * "Chưa vào ca" (everyone else, including checked_out) on right.
 *
 * Each row: name + position + hourly_rate left, status badge + role-gated
 * action buttons right.
 *
 * Pure prop-driven; parent owns all modal state. Buttons emit callbacks.
 */
export function EmployeeGrid({
  employees,
  shiftByEmployee,
  canManage,
  isOwner,
  accountedEmployeeIds,
  onCheckIn,
  onCheckOut,
  onEditEmployee,
  onGrantAccount,
}: EmployeeGridProps) {
  const active = employees.filter(
    (emp) => shiftByEmployee.get(emp.id)?.status === "checked_in"
  );
  const inactive = employees.filter(
    (emp) => shiftByEmployee.get(emp.id)?.status !== "checked_in"
  );

  function renderRow(employee: Employee) {
    const shift = shiftByEmployee.get(employee.id);
    const isIn = shift?.status === "checked_in";
    return (
      <article
        key={employee.id}
        className={cn(
          // flex-wrap: ở màn hẹp cụm badge + nút rớt xuống hàng riêng thay vì
          // ép min-width ~400px làm cả trang bị kéo ngang (375px). Desktop đủ
          // chỗ nên không wrap — giao diện không đổi.
          "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3 transition-colors",
          "hover:border-border-strong"
        )}
      >
        <div className="min-w-0">
          <strong className="block truncate text-sm font-semibold text-ink">
            {employee.name}
          </strong>
          <span className="text-xs text-muted">
            {employee.position ?? "Nhân viên"} ·{" "}
            {formatVND(employee.hourly_rate)}/giờ
          </span>
          {(shift?.check_in_ip || shift?.check_in_user_agent) && (
            <span
              className="mt-0.5 block truncate text-[11px] text-muted"
              title={
                [
                  shift.check_in_ip ? `IP: ${shift.check_in_ip}` : null,
                  shift.check_in_user_agent ? `Thiết bị: ${shift.check_in_user_agent}` : null,
                ]
                  .filter(Boolean)
                  .join("\n") || undefined
              }
            >
              Tự chấm công · {shift.check_in_ip ?? "?"}
              {shift.check_in_user_agent ? ` · ${shift.check_in_user_agent}` : ""}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {statusBadge(shift?.status)}
          {canManage &&
            (accountedEmployeeIds.has(employee.id) ? (
              <Badge variant="soft" semantic="neutral">Đã có TK</Badge>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onGrantAccount(employee)}
              >
                Cấp tài khoản
              </Button>
            ))}
          {canManage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEditEmployee(employee)}
            >
              Sửa
            </Button>
          )}
          {isOwner && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onCheckIn(employee)}
                disabled={isIn}
              >
                Vào ca
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => shift && onCheckOut(shift)}
                disabled={!shift || !isIn}
              >
                Ra ca
              </Button>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-3">
      {!isOwner && (
        <p className="text-xs text-muted">
          Nhân viên tự vào/ra ca ở màn “Chấm công”. Đính chính giờ giấc do chủ quán thực hiện.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Đang làm việc</CardTitle>
          </CardHeader>
          <CardBody>
            {active.length === 0 ? (
              <EmptyState
                icon="users"
                title="Chưa có ai đang làm"
                subtitle={
                  isOwner
                    ? "Nhấn 'Vào ca' ở cột bên cạnh khi nhân viên bắt đầu làm."
                    : "Nhân viên tự vào ca ở màn Chấm công."
                }
              />
            ) : (
              <Reveal stagger className="space-y-2">{active.map(renderRow)}</Reveal>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Chưa vào ca</CardTitle>
          </CardHeader>
          <CardBody>
            {inactive.length === 0 ? (
              <EmptyState
                icon="checkCircle"
                title="Tất cả đã vào ca"
                subtitle="Không còn nhân viên chờ xác nhận."
              />
            ) : (
              <Reveal stagger className="space-y-2">{inactive.map(renderRow)}</Reveal>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
