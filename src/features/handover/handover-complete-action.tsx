"use client";

import { useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCompleteHandoverSession } from "@/hooks/mutations/use-handover-mutations";

interface HandoverCompleteActionProps {
  sessionId: string;
  businessDate: string;
  doneCount: number;
  totalCount: number;
}

/**
 * "Hoàn tất bàn giao" button + nested confirm modal.
 *
 * Click button → opens confirm modal.
 *   - If doneCount < totalCount: AlertBanner.warning with undone count
 *   - If all done: AlertBanner.info confirming all done
 * Two buttons in modal: "Hủy" (ghost) + "Xác nhận hoàn tất" (destructive, loading state)
 *
 * On confirm: fires useCompleteHandoverSession → on success, modal auto-closes
 * via session refetch (parent re-renders read-only when session.status flips).
 */
export function HandoverCompleteAction({
  sessionId,
  businessDate,
  doneCount,
  totalCount
}: HandoverCompleteActionProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const completeM = useCompleteHandoverSession(supabase, businessDate);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const undoneCount = totalCount - doneCount;
  const allDone = undoneCount === 0;
  const isBusy = completeM.isPending;

  async function handleConfirm() {
    if (isBusy) return;
    try {
      await completeM.mutateAsync({ sessionId });
      toast({ semantic: "success", message: "Đã hoàn tất bàn giao." });
      setConfirmOpen(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không hoàn tất được."
      });
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          onClick={() => setConfirmOpen(true)}
        >
          Hoàn tất bàn giao
        </Button>
      </div>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ModalContent className="w-[min(95vw,32rem)]">
          <ModalTitle>Xác nhận hoàn tất bàn giao</ModalTitle>
          <ModalDescription>
            Sau khi hoàn tất, session sẽ bị khóa — không thể tick / sửa lại task hay ghi chú.
          </ModalDescription>
          <div className="mt-6 space-y-4">
            {allDone ? (
              <AlertBanner variant="info">
                Đã hoàn thành tất cả {totalCount} task. Xác nhận hoàn tất?
              </AlertBanner>
            ) : (
              <AlertBanner variant="warning">
                Còn <strong>{undoneCount}</strong> task chưa xong (trong tổng {totalCount}).
                Vẫn hoàn tất bàn giao?
              </AlertBanner>
            )}
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={isBusy}>
                Hủy
              </Button>
              <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirm}>
                Xác nhận hoàn tất
              </Button>
            </ModalActions>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}
