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
    try {
      for (const id of shiftIds) {
        await cancelShiftAssignment(supabase, id, reason.trim());
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.openShifts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      toast({ semantic: "success", message: `Đã huỷ ${shiftIds.length} ca (không tính lương).` });
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      toast({ semantic: "danger", message: err instanceof Error ? err.message : "Không huỷ hết được." });
    } finally {
      setIsBusy(false);
    }
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
