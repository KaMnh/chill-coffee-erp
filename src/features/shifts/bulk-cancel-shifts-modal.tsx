"use client";

import { useState } from "react";
import { Modal, ModalContent, ModalTitle, ModalDescription, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import { cancelShiftAssignment } from "@/lib/data/shifts";

interface BulkCancelShiftsModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shiftIds: ReadonlyArray<string>;
  businessDate: string;
  onDone?(): void;
}

export function BulkCancelShiftsModal({ open, onOpenChange, shiftIds, businessDate, onDone }: BulkCancelShiftsModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleConfirm() {
    if (!supabase || isBusy) return;
    if (reason.trim() === "") { toast({ semantic: "danger", message: "Phải nhập lý do." }); return; }
    setIsBusy(true);
    // Resilient per-id loop: một ca lỗi KHÔNG được chặn các ca còn lại. Ca đã
    // đóng/không tồn tại coi như đã xử lý (idempotent retry). Luôn refresh +
    // onDone() ở cuối để parent lấy danh sách ca mới (đã loại các ca vừa huỷ).
    let ok = 0;
    let failed = 0;
    for (const id of shiftIds) {
      try {
        await cancelShiftAssignment(supabase, id, reason.trim());
        ok += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (/đã đóng|không tồn tại/i.test(msg)) {
          ok += 1; // ca đã đóng từ lần trước → coi như thành công, đi tiếp.
        } else {
          failed += 1; // lỗi khác → đếm fail nhưng vẫn tiếp tục vòng lặp.
        }
      }
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.openShifts() });
    queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    onDone?.();
    if (failed === 0) {
      toast({ semantic: "success", message: `Đã huỷ ${ok} ca (không tính lương).` });
      onOpenChange(false);
    } else {
      // Giữ modal mở để user thử lại với danh sách đã refresh.
      toast({ semantic: "danger", message: `Đã huỷ ${ok} ca, còn ${failed} ca lỗi — thử lại.` });
    }
    setIsBusy(false);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Đóng hết ca chưa ra ({shiftIds.length})</ModalTitle>
        <ModalDescription>Huỷ tất cả ca còn mở của ngày này — KHÔNG tính lương. Cần lý do.</ModalDescription>
        <Textarea label="Lý do" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} disabled={isBusy} />
        <ModalActions>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>Đóng</Button>
          <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirm}>Huỷ hết</Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
