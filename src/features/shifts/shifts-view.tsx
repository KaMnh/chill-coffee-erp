"use client";

import { useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useEmployeesQuery,
  useShiftsQuery,
  usePayrollQuery,
} from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { IconButton } from "@/components/ui/icon-button";
import type {
  Employee,
  PayrollRecord,
  ShiftAssignment,
  UserRole,
} from "@/lib/types";
import { EmployeeGrid } from "./employee-grid";
import { PayrollHistoryCard } from "./payroll-history-card";
import { CheckInModal } from "./check-in-modal";
import { CheckOutModal } from "./check-out-modal";
import { EmployeeFormModal } from "./employee-form-modal";
import { PayrollEditModal } from "./payroll-edit-modal";

interface ShiftsViewProps {
  businessDate: string;
  role: UserRole;
}

/**
 * Top-level container for view === "shifts". Mounts 3 queries
 * (employees + shifts + payroll) and composes EmployeeGrid +
 * PayrollHistoryCard + 4 modals.
 *
 * Owns all modal state — children emit callbacks. Computes
 * shiftByEmployee map (first-wins reduce to preserve v3 part-time
 * idiom where one employee can have multiple shifts/day).
 */
export function ShiftsView({ businessDate, role }: ShiftsViewProps) {
  const supabase = useSupabase();
  const employeesQuery = useEmployeesQuery(supabase, true);
  const shiftsQuery = useShiftsQuery(supabase, businessDate, true);
  const payrollQuery = usePayrollQuery(supabase, businessDate, true);

  const canManage = role === "owner" || role === "manager";
  // Phase 2b: chấm công/sửa lương thủ công khóa về owner-only (nhân viên tự
  // vào/ra ca ở màn Chấm công). Quản lý/NV vẫn XEM trang ca + quản lý hồ sơ NV.
  const isOwner = role === "owner";

  // Modal state (5 separate slots — only one is non-null at a time,
  // but separate state lets each modal's own useEffect drive resets).
  // Cấp/liên kết tài khoản đã chuyển hẳn sang trang Cài đặt (không còn ở đây).
  const [checkInTarget, setCheckInTarget] = useState<Employee | null>(null);
  const [checkOutTarget, setCheckOutTarget] = useState<ShiftAssignment | null>(null);
  const [editingPayroll, setEditingPayroll] = useState<PayrollRecord | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [showCreateEmployee, setShowCreateEmployee] = useState(false);

  if (
    employeesQuery.isLoading ||
    shiftsQuery.isLoading ||
    payrollQuery.isLoading
  ) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (shiftsQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được danh sách ca">
        {shiftsQuery.error instanceof Error
          ? shiftsQuery.error.message
          : String(shiftsQuery.error)}
      </AlertBanner>
    );
  }

  if (payrollQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được lương theo ca">
        {payrollQuery.error instanceof Error
          ? payrollQuery.error.message
          : String(payrollQuery.error)}
      </AlertBanner>
    );
  }

  const employees = employeesQuery.data ?? [];
  const shifts = shiftsQuery.data ?? [];
  const payroll = payrollQuery.data ?? [];

  // First-wins reduce: shifts come pre-sorted DESC by check_in_at from
  // loadShiftAssignments. Part-time employees may have multiple shifts
  // per day — first-wins preserves the MOST RECENT shift per employee
  // (the one currently active or just closed). Map(...) would last-wins
  // and keep the OLDEST shift, breaking the status badge.
  const shiftByEmployee = shifts.reduce((map, shift) => {
    if (!map.has(shift.employee_id)) map.set(shift.employee_id, shift);
    return map;
  }, new Map<string, ShiftAssignment>());

  // Find the Employee object for the current check-out target — needed by
  // CheckOutModal for hourly_rate (basePay calc).
  const checkOutEmployee = checkOutTarget
    ? employees.find((e) => e.id === checkOutTarget.employee_id) ?? null
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Tác nghiệp ca
          </p>
          <h2 className="font-display text-2xl text-ink">Nhân viên hôm nay</h2>
        </div>
        {canManage && (
          <IconButton
            icon="plus"
            size={40}
            variant="primary"
            aria-label="Thêm nhân viên"
            onClick={() => setShowCreateEmployee(true)}
          />
        )}
      </div>
      <EmployeeGrid
        employees={employees}
        shiftByEmployee={shiftByEmployee}
        canManage={canManage}
        isOwner={isOwner}
        onCheckIn={setCheckInTarget}
        onCheckOut={setCheckOutTarget}
        onEditEmployee={setEditingEmployee}
      />
      <PayrollHistoryCard
        payroll={payroll}
        canEdit={isOwner}
        onEditRow={setEditingPayroll}
      />
      {/* Modals */}
      <CheckInModal
        open={checkInTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCheckInTarget(null);
        }}
        employee={checkInTarget}
        businessDate={businessDate}
      />
      <CheckOutModal
        open={checkOutTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCheckOutTarget(null);
        }}
        shift={checkOutTarget}
        employee={checkOutEmployee}
        businessDate={businessDate}
      />
      <EmployeeFormModal
        open={showCreateEmployee || editingEmployee !== null}
        onOpenChange={(next) => {
          if (!next) {
            setShowCreateEmployee(false);
            setEditingEmployee(null);
          }
        }}
        employee={editingEmployee}
      />
      <PayrollEditModal
        open={editingPayroll !== null}
        onOpenChange={(next) => {
          if (!next) setEditingPayroll(null);
        }}
        payroll={editingPayroll}
      />
    </div>
  );
}
