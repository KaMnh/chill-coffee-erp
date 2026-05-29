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
  canManage: boolean;
  onCheckIn(employee: Employee): void;
  onCheckOut(shift: ShiftAssignment): void;
  onEditEmployee(employee: Employee): void;
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
  onCheckIn,
  onCheckOut,
  onEditEmployee,
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
          "flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3 transition-colors",
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
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(shift?.status)}
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
        </div>
      </article>
    );
  }

  return (
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
              subtitle="Nhấn 'Vào ca' ở cột bên cạnh khi nhân viên bắt đầu làm."
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
  );
}
