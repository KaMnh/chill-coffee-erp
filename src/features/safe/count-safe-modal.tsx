"use client";

import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCountSafe } from "@/hooks/mutations/use-safe-mutations";
import { formatVND } from "@/lib/format";
import { DenominationGrid } from "@/features/cash/denomination-grid";
import { computeDenominationTotal } from "@/features/cash/cash-math";

interface CountSafeModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called when user clicks "Điều chỉnh ngay" on the result view.
   *  Parent closes this modal + opens AdjustSafeModal with newBalance pre-filled. */
  onAdjustChain: (totalPhysical: number) => void;
}

type Step = "count" | "result";

/**
 * Snapshot the physical denomination count in safe_counts. Does NOT
 * affect safe_balance (the RPC just records the snapshot).
 *
 * After save:
 *   - difference === 0 → success "Khớp sổ quỹ" + close
 *   - difference !== 0 → switch to result view showing diff + 2 buttons:
 *     "Đóng" (no change) or "Điều chỉnh ngay" (triggers chain → AdjustSafeModal
 *     opens with newBalance = total_physical pre-filled)
 *
 * Reuses DenominationGrid from cash module (Phase 3B.2b.i).
 */
export function CountSafeModal({ open, onOpenChange, onAdjustChain }: CountSafeModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const countM = useCountSafe(supabase);

  const [step, setStep] = useState<Step>("count");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{
    total_physical: number;
    expected_balance: number;
    difference: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setStep("count");
      setCounts({});
      setNote("");
      setResult(null);
    }
  }, [open]);

  const total = computeDenominationTotal(counts);
  const isBusy = countM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy || total === 0) return;
    try {
      const r = await countM.mutateAsync({
        denominations: counts,
        note: note || undefined
      });
      setResult({
        total_physical: r.total_physical,
        expected_balance: r.expected_balance,
        difference: r.difference
      });
      setStep("result");
      if (r.difference === 0) {
        toast({ semantic: "success", message: "Khớp sổ quỹ!" });
      } else {
        toast({
          semantic: "warning",
          message: `Lệch ${formatVND(Math.abs(r.difference))} so với sổ quỹ.`
        });
      }
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được lần đếm."
      });
    }
  }

  function handleAdjustChain() {
    if (!result) return;
    onAdjustChain(result.total_physical);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,40rem)]">
        <ModalTitle>
          {step === "count" ? "Đếm sổ quỹ (snapshot)" : "Kết quả đếm"}
        </ModalTitle>
        <ModalDescription>
          {step === "count"
            ? "Đếm tờ thực tế trong két. RPC sẽ lưu snapshot mệnh giá — KHÔNG tự động điều chỉnh số dư."
            : "Đối chiếu kết quả vừa đếm."}
        </ModalDescription>

        {step === "count" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <DenominationGrid
              value={counts}
              onChange={setCounts}
              disabled={isBusy}
              showQuickAdd={true}
              totalLabel="Tổng đếm"
            />
            <Textarea
              label="Ghi chú"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="VD: Đếm cuối tháng 5, kiểm kê quý..."
              disabled={isBusy}
              helper="Tùy chọn"
            />
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Hủy
              </Button>
              <Button type="submit" variant="primary" loading={isBusy} disabled={total === 0}>
                Lưu {total > 0 ? formatVND(total) : ""}
              </Button>
            </ModalActions>
          </form>
        )}

        {step === "result" && result && (
          <div className="mt-6 space-y-4">
            <div className="rounded-md border border-border p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">Đếm thực:</span><strong>{formatVND(result.total_physical)}</strong></div>
              <div className="flex justify-between"><span className="text-muted">Dự kiến (sổ quỹ):</span><strong>{formatVND(result.expected_balance)}</strong></div>
              <div className="flex justify-between border-t border-border pt-1">
                <span className="text-muted">Lệch:</span>
                <strong className={result.difference === 0 ? "text-success" : result.difference > 0 ? "text-success" : "text-danger"}>
                  {result.difference > 0 ? "+" : ""}{formatVND(result.difference)}
                </strong>
              </div>
            </div>
            {result.difference === 0 ? (
              <AlertBanner variant="success">
                Đếm khớp sổ quỹ. Không cần điều chỉnh.
              </AlertBanner>
            ) : (
              <AlertBanner variant="warning">
                Đếm thực {result.difference > 0 ? "thừa" : "thiếu"} {formatVND(Math.abs(result.difference))} so với sổ quỹ.
                Click &quot;Điều chỉnh ngay&quot; nếu muốn cập nhật số dư theo đếm thực.
              </AlertBanner>
            )}
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
              {result.difference !== 0 && (
                <Button type="button" variant="primary" onClick={handleAdjustChain}>
                  Điều chỉnh ngay
                </Button>
              )}
            </ModalActions>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
