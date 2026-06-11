"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/text-field";
import { Reveal } from "@/components/ui/reveal";
import { formatNumber, formatVND, formatVNDCompact } from "@/lib/format";
import { Sheet } from "../sheet";
import { usePreview, SectionLabel, MoneyField, Chip, SuggestNote } from "../bits";
import { getPreviewData } from "../../_mock/data";

const WITHDRAW_CATEGORIES = ["Điện / nước", "Mặt bằng", "Nhập hàng", "Bảo trì", "Khác"];

/**
 * Sổ quỹ (owner-only) — Tier B: tổng + 2 quỹ dạng card stack, hành động
 * 2×2, lịch sử = list; "Rút khác" demo bằng bottom sheet (fund-split CK trước).
 */
export function MobileSafeView() {
  const { role, scenario } = usePreview();
  const safe = getPreviewData(scenario).safe;

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState(WITHDRAW_CATEGORIES[0]);

  if (role !== "owner") {
    return (
      <div className="p-4">
        <EmptyState
          icon="lock"
          title="Sổ quỹ owner only"
          subtitle="Chỉ chủ quán xem được sổ quỹ. Đổi role ở thanh điều khiển preview."
          dashedBorder
        />
      </div>
    );
  }

  const total = safe.cash + safe.transfer;
  // defaultFundSplit thật: ưu tiên chuyển khoản trước, tiền mặt phần còn lại.
  const fromTransfer = Math.min(amount, safe.transfer);
  const fromCash = Math.max(0, amount - fromTransfer);

  return (
    <Reveal stagger className="p-4 space-y-4">
      {/* Tổng quỹ */}
      <div className="rounded-2xl bg-peach p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-peach-ink">Tổng quỹ hiện tại</div>
          <span className="text-xs text-peach-ink/70">{safe.txnCount} giao dịch</span>
        </div>
        <div className="font-display text-3xl font-bold text-peach-ink tabular-nums mt-2">
          <CountUp value={total} format={formatVND} />
        </div>
      </div>

      {/* 2 quỹ */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-surface shadow-raised p-4">
          <div className="text-xs text-muted">Quỹ tiền mặt</div>
          <div className="font-display text-lg font-bold text-ink tabular-nums mt-1">
            {formatVND(safe.cash)}
          </div>
        </div>
        <div className="rounded-lg bg-surface shadow-raised p-4">
          <div className="text-xs text-muted">Quỹ chuyển khoản</div>
          <div className="font-display text-lg font-bold text-ink tabular-nums mt-1">
            {formatVND(safe.transfer)}
          </div>
        </div>
      </div>

      {/* Hành động 2×2 — sheet */}
      <div className="grid grid-cols-2 gap-2">
        {([
          ["Rút khác", "arrowDownRight", () => setWithdrawOpen(true)],
          ["Nhập nguyên liệu", "package", undefined],
          ["Điều chỉnh", "pencil", undefined],
          ["Đếm sổ quỹ", "calculator", undefined],
        ] as Array<[string, IconName, (() => void) | undefined]>).map(([label, icon, onClick]) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className={cn(
              "h-14 rounded-lg bg-surface shadow-raised px-4 flex items-center gap-3 text-left",
              onClick ? "active:bg-surface-muted" : "opacity-70"
            )}
          >
            <span className="w-9 h-9 rounded-full bg-accent-soft text-accent-dark flex items-center justify-center">
              <Icon name={icon} size={20} />
            </span>
            <span className="text-sm font-medium text-ink leading-tight">{label}</span>
          </button>
        ))}
      </div>
      <SuggestNote>Nhập NL / Điều chỉnh / Đếm — sheet riêng khi build thật; demo: Rút khác</SuggestNote>

      {/* Lịch sử */}
      <div>
        <SectionLabel className="mb-2">Lịch sử sổ quỹ</SectionLabel>
        <div className="rounded-lg border border-border overflow-hidden">
          {safe.history.map((h, i) => (
            <div key={i} className={cn("p-3 bg-surface", i > 0 && "border-t border-border")}>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-medium text-ink truncate">{h.type}</span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    h.amount > 0 ? "text-success" : "text-danger"
                  )}
                >
                  {h.amount > 0 ? "+" : ""}
                  {formatVNDCompact(h.amount)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="soft" semantic={h.fund === "Chuyển khoản" ? "success" : "neutral"}>
                  {h.fund}
                </Badge>
                <span className="flex-1 text-xs text-muted truncate">{h.time} · {h.desc}</span>
                <span className="text-xs text-muted tabular-nums">dư {formatVNDCompact(h.balanceAfter)}</span>
              </div>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="lg" className="w-full mt-2">
          Tải thêm 90 ngày trước
        </Button>
      </div>

      {/* Sheet: Rút khác */}
      <Sheet open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Rút khác từ sổ quỹ" tall>
        <div className="space-y-4">
          <MoneyField label="Tổng tiền rút" value={amount} onChange={setAmount} autoFocus />

          {amount > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-surface-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted">Từ chuyển khoản</div>
                <div className="text-sm font-semibold text-ink tabular-nums mt-0.5">
                  {formatNumber(fromTransfer)} ₫
                </div>
              </div>
              <div className="rounded-lg bg-surface-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted">Từ tiền mặt</div>
                <div className="text-sm font-semibold text-ink tabular-nums mt-0.5">
                  {formatNumber(fromCash)} ₫
                </div>
              </div>
            </div>
          )}

          <div>
            <SectionLabel className="mb-1.5">Hạng mục</SectionLabel>
            <div className="flex gap-2 flex-wrap">
              {WITHDRAW_CATEGORIES.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>

          <TextField label="Mô tả" placeholder="VD: Tiền điện tháng 6 — EVN" className="text-base h-12" />

          <Button
            size="lg"
            className="w-full"
            disabled={amount === 0 || amount > total}
            onClick={() => {
              setWithdrawOpen(false);
              setAmount(0);
            }}
          >
            Rút {formatVND(amount)}
          </Button>
          {amount > total && (
            <p className="text-xs text-danger">Vượt tổng quỹ hiện có ({formatVND(total)}).</p>
          )}
        </div>
      </Sheet>
    </Reveal>
  );
}
