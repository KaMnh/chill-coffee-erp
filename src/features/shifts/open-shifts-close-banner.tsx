"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OpenShiftsTable, type OpenShiftRow } from "./open-shifts-table";

interface OpenShiftsCloseBannerProps {
  /** Ca checked_in của ngày đang chốt. */
  shifts: ReadonlyArray<OpenShiftRow>;
  /** owner/manager mới thấy nút đóng. */
  canManage: boolean;
  onClose(shift: OpenShiftRow): void;
  onBulk(): void;
}

/** Nội dung banner "còn ca chưa ra ca" trong Chốt két: text + Xem&đóng + Đóng hết. */
export function OpenShiftsCloseBanner({ shifts, canManage, onClose, onBulk }: OpenShiftsCloseBannerProps) {
  const [show, setShow] = useState(false);
  const names = shifts.map((s) => s.employee_name).filter(Boolean).join(", ");
  return (
    <div className="space-y-2">
      <p>
        Còn {shifts.length} ca chưa ra ca{names ? `: ${names}` : ""}.
      </p>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? "Ẩn" : "Xem & đóng"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBulk}>
            Đóng hết (huỷ, không lương)
          </Button>
        </div>
      )}
      {show && <OpenShiftsTable shifts={shifts} onClose={onClose} />}
    </div>
  );
}
