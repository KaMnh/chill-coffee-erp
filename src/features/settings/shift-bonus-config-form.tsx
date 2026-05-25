"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateShiftBonusConfig } from "@/hooks/mutations/use-settings-mutations";
import { formatVND } from "@/lib/format";

interface ShiftBonusConfigFormProps {
  config: { threshold_hours: number; bonus_amount: number };
}

/**
 * Editor cho app_settings.shift_bonus_config.
 *
 * Logic: khi nhân viên check-out và tổng giờ ca >= threshold_hours, modal
 * "Ra ca" sẽ pre-fill ô "Bồi dưỡng" bằng bonus_amount. User vẫn có quyền
 * chỉnh thủ công sau đó.
 *
 * Validation: cả hai phải >= 0; threshold thường 6-12h; bonus thường 10k-100k.
 */
export function ShiftBonusConfigForm({ config }: ShiftBonusConfigFormProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateShiftBonusConfig(supabase);

  const [thresholdHours, setThresholdHours] = useState(String(config.threshold_hours));
  const [bonusAmount, setBonusAmount] = useState(String(config.bonus_amount));

  // Re-sync nếu config từ server thay đổi (vd: tab khác sửa)
  useEffect(() => {
    setThresholdHours(String(config.threshold_hours));
    setBonusAmount(String(config.bonus_amount));
  }, [config.threshold_hours, config.bonus_amount]);

  const thresholdNum = Number(thresholdHours);
  const bonusNum = Number(bonusAmount.replace(/[^0-9]/g, ""));
  const valid =
    Number.isFinite(thresholdNum) && thresholdNum >= 0 &&
    Number.isFinite(bonusNum) && bonusNum >= 0;
  const dirty =
    thresholdNum !== config.threshold_hours || bonusNum !== config.bonus_amount;
  const isBusy = updateM.isPending;

  async function handleSave() {
    if (!valid || !dirty || isBusy) return;
    try {
      await updateM.mutateAsync({
        threshold_hours: thresholdNum,
        bonus_amount: bonusNum,
      });
      toast({ semantic: "success", message: "Đã lưu cấu hình bồi dưỡng." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được cấu hình."
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Bồi dưỡng tự động cho ca dài</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Khi ca làm việc đạt hoặc vượt ngưỡng giờ, modal &quot;Ra ca&quot; sẽ tự gợi ý
            tiền bồi dưỡng. Nhân viên/quản lý vẫn có thể chỉnh tay trước khi lưu.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label="Ngưỡng giờ (h)"
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            value={thresholdHours}
            onChange={(e) => setThresholdHours(e.target.value)}
            disabled={isBusy}
            helper="Ca >= ngưỡng này sẽ được auto-fill bonus."
          />
          <TextField
            label="Số tiền bồi dưỡng (VND)"
            type="text"
            inputMode="numeric"
            value={bonusAmount}
            onChange={(e) => setBonusAmount(e.target.value.replace(/[^0-9]/g, ""))}
            disabled={isBusy}
            helper={
              Number.isFinite(bonusNum) && bonusNum > 0
                ? `≈ ${formatVND(bonusNum)}`
                : "Tiền VND, không có dấu phân cách."
            }
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            loading={isBusy}
            disabled={!valid || !dirty}
            onClick={handleSave}
          >
            Lưu cấu hình
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
