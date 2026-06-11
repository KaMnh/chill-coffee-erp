"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Reveal } from "@/components/ui/reveal";
import { formatNumber, formatVND } from "@/lib/format";
import { Sheet } from "../sheet";
import { usePreview, ViewStates, SectionLabel, SuggestNote, Chip } from "../bits";
import { getPreviewData, DENOMINATIONS } from "../../_mock/data";

/**
 * Chốt két — Tier A, màn then chốt nhất của thu ngân.
 *
 * Redesign denomination grid cho mobile (thay grid-cols-[100px_auto_1fr_auto]):
 * mỗi mệnh giá = 1 hàng full-width 2 tầng — tầng trên nhãn + tổng dòng,
 * tầng dưới stepper lớn (44px) + ô số numeric + chip cộng nhanh wrap.
 * Tổng cộng + nút Chốt sticky ở đáy vùng cuộn (thumb zone, 1 tay).
 */
export function MobileCashView() {
  const { scenario } = usePreview();
  const data = getPreviewData(scenario);
  const cash = data.cash;

  const [step, setStep] = useState<1 | 2>(1);
  const [counts, setCounts] = useState<Record<string, number>>(cash.counts);
  const [nextDay, setNextDay] = useState<Record<string, number>>({
    "100000": 5, "50000": 10, "20000": 15, "10000": 20, "5000": 10, "2000": 5, "1000": 10,
  });
  const [reconOpen, setReconOpen] = useState(false);
  const [openingSheet, setOpeningSheet] = useState(false);

  const physical = useMemo(
    () => DENOMINATIONS.reduce((sum, d) => sum + d * (counts[String(d)] ?? 0), 0),
    [counts]
  );
  const leaveTotal = useMemo(
    () => DENOMINATIONS.reduce((sum, d) => sum + d * (nextDay[String(d)] ?? 0), 0),
    [nextDay]
  );
  const safeDeposit = Math.max(0, physical - leaveTotal);

  // Công thức đối soát thật (cash-math.ts).
  const reconciliation = physical - cash.opening + cash.bankTransfer + cash.expenseCash + cash.payrollCash;
  const difference = cash.posTotal - reconciliation;
  const matched = difference === 0;

  const active = step === 1 ? counts : nextDay;
  const setActive = step === 1 ? setCounts : setNextDay;

  function bump(denom: number, delta: number) {
    setActive((prev) => ({
      ...prev,
      [String(denom)]: Math.max(0, (prev[String(denom)] ?? 0) + delta),
    }));
  }

  const skeleton = (
    <div className="space-y-3 p-4">
      <Skeleton height="4rem" rounded="lg" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} height="5.5rem" rounded="lg" />
      ))}
    </div>
  );

  const empty = (
    <div className="p-4">
      <EmptyState
        icon="banknote"
        title="Chưa nhập tiền đầu ngày"
        subtitle="Nhập tiền đầu ngày trước khi đếm két để đối soát chính xác."
        action={<Button size="lg">Nhập tiền đầu ngày</Button>}
        dashedBorder
      />
    </div>
  );

  return (
    <ViewStates scenario={scenario} skeleton={skeleton} empty={empty}>
      <div className="flex flex-col min-h-full">
        <div className="p-4 space-y-4">
          {scenario === "warn" && (
            <AlertBanner variant="danger" title="POS sync lỗi.">
              Số POS lấy lúc 11:02 — có thể thiếu đơn. Cân nhắc nhập POS thủ công.
            </AlertBanner>
          )}

          {/* Tiền đầu ngày — card gọn, mở sheet xem chi tiết */}
          <button
            type="button"
            onClick={() => setOpeningSheet(true)}
            className="w-full rounded-lg bg-surface shadow-raised p-4 flex items-center gap-3 text-left"
          >
            <div className="flex-1 min-w-0">
              <SectionLabel>Tiền đầu ngày</SectionLabel>
              <div className="font-display text-xl font-bold text-ink tabular-nums mt-0.5">
                {formatVND(cash.opening)}
              </div>
            </div>
            <Badge variant="soft" semantic="success">Đã nhập</Badge>
            <Icon name="chevronRight" size={16} className="text-muted/60" />
          </button>

          {/* Segmented 2 bước */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-surface-muted" role="tablist" aria-label="Bước chốt két">
            {([1, 2] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={step === s}
                onClick={() => setStep(s)}
                className={cn(
                  "h-11 rounded-full text-sm font-medium transition-colors",
                  step === s ? "bg-ink text-white shadow-raised" : "text-muted"
                )}
              >
                {s === 1 ? "1 · Đếm cuối ngày" : "2 · Để lại ngày mai"}
              </button>
            ))}
          </div>

          {step === 2 && leaveTotal > physical && (
            <AlertBanner variant="danger">
              Tiền để lại ({formatVND(leaveTotal)}) đang lớn hơn tiền đếm thực.
            </AlertBanner>
          )}

          {/* Denomination rows — redesign mobile */}
          <Reveal key={step} stagger className="space-y-2">
            {DENOMINATIONS.map((denom) => {
              const count = active[String(denom)] ?? 0;
              return (
                <article
                  key={denom}
                  className={cn(
                    "rounded-lg border bg-surface p-3 transition-colors",
                    count > 0 ? "border-border-strong/20" : "border-border"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <strong className="font-display text-base text-ink">{formatVND(denom)}</strong>
                    <span className={cn("text-sm tabular-nums", count > 0 ? "text-ink font-semibold" : "text-muted/60")}>
                      {count > 0 ? formatNumber(denom * count) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => bump(denom, -1)}
                      aria-label={`Giảm 1 tờ ${formatVND(denom)}`}
                      className="w-11 h-11 shrink-0 rounded-full border border-border bg-surface flex items-center justify-center text-ink active:bg-surface-muted"
                    >
                      <Icon name="minus" size={20} />
                    </button>
                    <input
                      inputMode="numeric"
                      value={count === 0 ? "" : count}
                      placeholder="0"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const n = Math.max(0, Number(e.target.value.replace(/[^0-9]/g, "")) || 0);
                        setActive((prev) => ({ ...prev, [String(denom)]: n }));
                      }}
                      aria-label={`${formatVND(denom)} số tờ`}
                      className="w-16 h-11 shrink-0 rounded-md border border-border bg-surface text-center text-base font-semibold text-ink tabular-nums focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong"
                    />
                    <button
                      type="button"
                      onClick={() => bump(denom, +1)}
                      aria-label={`Tăng 1 tờ ${formatVND(denom)}`}
                      className="w-11 h-11 shrink-0 rounded-full border border-border bg-surface flex items-center justify-center text-ink active:bg-surface-muted"
                    >
                      <Icon name="plus" size={20} />
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end flex-1">
                      {[5, 10, 20].map((delta) => (
                        <button
                          key={delta}
                          type="button"
                          onClick={() => bump(denom, delta)}
                          aria-label={`Cộng ${delta} tờ ${formatVND(denom)}`}
                          className="h-11 min-w-11 px-2.5 rounded-full border border-border bg-surface-muted text-xs font-medium text-ink active:border-border-strong"
                        >
                          +{delta}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </Reveal>

          {step === 2 && (
            <div className="grid grid-cols-3 gap-2">
              {([
                ["Đếm cuối ngày", physical],
                ["Để lại mai", leaveTotal],
                ["Nạp sổ quỹ", safeDeposit],
              ] as Array<[string, number]>).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-surface-muted p-2.5 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
                  <div className="text-sm font-semibold text-ink tabular-nums mt-0.5">
                    {formatNumber(value)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Đối soát thu gọn — accordion */}
          <div className="rounded-lg bg-surface shadow-raised overflow-hidden">
            <button
              type="button"
              onClick={() => setReconOpen((v) => !v)}
              aria-expanded={reconOpen}
              className="w-full p-4 flex items-center gap-3 text-left"
            >
              <div className="flex-1">
                <SectionLabel>Đối soát</SectionLabel>
                <div className={cn("font-display text-lg font-bold tabular-nums mt-0.5", matched ? "text-success" : "text-danger")}>
                  {matched ? "Khớp · 0 ₫" : `Lệch ${difference > 0 ? "+" : ""}${formatNumber(difference)} ₫`}
                </div>
              </div>
              <Badge variant="soft" semantic={matched ? "success" : "danger"} withDot>
                {matched ? "Khớp" : "Cần kiểm tra"}
              </Badge>
              <Icon name="chevronDown" size={16} className={cn("text-muted/60 transition-transform", reconOpen && "rotate-180")} />
            </button>
            {reconOpen && (
              <dl className="px-4 pb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm border-t border-border pt-3">
                {([
                  ["Tổng POS", cash.posTotal],
                  ["POS tiền mặt", cash.posCash],
                  ["POS chuyển khoản", cash.posNonCash],
                  ["Tiền vào ca", cash.opening],
                  ["Tiền thực đếm", physical],
                  ["CK đã nhận", cash.bankTransfer],
                  ["Chi phí cash", cash.expenseCash],
                  ["Lương đã phát", cash.payrollCash],
                ] as Array<[string, number]>).map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-right text-ink tabular-nums">{formatNumber(value)}</dd>
                  </div>
                ))}
                <div className="contents">
                  <dt className="font-semibold text-ink border-t border-border pt-1.5">Tổng đối soát</dt>
                  <dd className="text-right font-semibold text-ink tabular-nums border-t border-border pt-1.5">
                    {formatNumber(reconciliation)}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* Lịch sử trong ngày */}
          <div>
            <SectionLabel className="mb-2">Lịch sử trong ngày</SectionLabel>
            <div className="rounded-lg border border-border overflow-hidden">
              {cash.history.map((h, i) => (
                <div key={i} className={cn("p-3 bg-surface flex items-center gap-3", i > 0 && "border-t border-border")}>
                  <Badge variant="soft" semantic={h.type === "close" ? "success" : "neutral"}>
                    {h.type === "close" ? "Chốt két" : "Kiểm nhanh"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink tabular-nums">{formatVND(h.physical)}</div>
                    <div className="text-xs text-muted truncate">{h.time} · {h.note}</div>
                  </div>
                  <span className={cn("text-sm font-semibold tabular-nums", h.diff === 0 ? "text-success" : "text-danger")}>
                    {h.diff === 0 ? "0 ₫" : `${formatNumber(h.diff)} ₫`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky đáy: tổng + Chốt — luôn trong thumb zone */}
        <div className="sticky bottom-0 z-20 mt-auto bg-surface/95 backdrop-blur border-t border-border px-4 pt-3 pb-3 space-y-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">
              {step === 1 ? "Tổng đếm cuối ngày" : "Tổng để lại ngày mai"}
            </span>
            <strong className="font-display text-2xl font-bold text-ink tabular-nums">
              {formatVND(step === 1 ? physical : leaveTotal)}
            </strong>
          </div>
          {step === 1 ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button size="lg" className="w-full" onClick={() => setStep(2)} disabled={physical === 0}>
                Tiếp · bước 2
              </Button>
              <Button size="lg" variant="secondary" disabled={physical === 0}>
                Kiểm nhanh
              </Button>
            </div>
          ) : (
            <Button size="lg" className="w-full" disabled={leaveTotal > physical}>
              Chốt két & tạo báo cáo · nạp quỹ {formatNumber(safeDeposit)} ₫
            </Button>
          )}
        </div>

        {/* Sheet: chi tiết tiền đầu ngày */}
        <Sheet open={openingSheet} onClose={() => setOpeningSheet(false)} title="Tiền đầu ngày">
          <div className="space-y-3">
            <AlertBanner variant="info">
              Báo cáo chốt két ngày 10/06 đã để lại {formatVND(cash.opening)} cho hôm nay.
            </AlertBanner>
            <div className="rounded-lg border border-border divide-y divide-border">
              {[["100.000 ₫", 10], ["50.000 ₫", 8], ["20.000 ₫", 5]].map(([d, n]) => (
                <div key={String(d)} className="flex items-center justify-between px-3 h-11 text-sm">
                  <span className="text-ink">{d}</span>
                  <span className="text-muted tabular-nums">× {n}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <SuggestNote>Sửa tiền đầu ngày — sheet riêng khi build thật</SuggestNote>
              <div className="flex gap-1.5">
                <Chip onClick={() => setOpeningSheet(false)}>Đóng</Chip>
              </div>
            </div>
          </div>
        </Sheet>
      </div>
    </ViewStates>
  );
}
