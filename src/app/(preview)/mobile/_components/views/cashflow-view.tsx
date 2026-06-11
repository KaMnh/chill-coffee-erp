"use client";

import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { CountUp } from "@/components/ui/count-up";
import { Reveal } from "@/components/ui/reveal";
import { formatVND, formatVNDCompact } from "@/lib/format";
import { SectionLabel, SuggestNote } from "../bits";
import { CASHFLOW } from "../../_mock/data";

/**
 * Dòng tiền (owner/manager) — Tier B: KPI stack, chart Thu/Chi 7 ngày
 * thuần CSS (Recharts ComposedChart responsive khi build thật),
 * hạng mục chi với progress %. Lịch âm dương: để desktop (chú thích).
 */
export function MobileCashflowView() {
  const maxDay = Math.max(...CASHFLOW.byDay.map((d) => d.in));

  return (
    <Reveal stagger className="p-4 space-y-4">
      <div className="rounded-lg bg-surface shadow-raised p-4">
        <div className="flex items-center justify-between">
          <SectionLabel>Kỳ xem</SectionLabel>
          <Badge variant="soft" semantic="neutral">Tháng này</Badge>
        </div>
        <div className="text-sm font-medium text-ink mt-1">{CASHFLOW.period}</div>
        <div className="text-xs text-muted mt-0.5">{CASHFLOW.lunar}</div>
      </div>

      {/* KPI — 1 nổi bật + 2 phụ */}
      <div className="rounded-2xl bg-mint p-5">
        <div className="text-sm font-medium text-mint-ink">Chênh lệch kỳ này</div>
        <div className="font-display text-3xl font-bold text-mint-ink tabular-nums mt-1.5">
          <CountUp value={CASHFLOW.net} format={formatVND} />
        </div>
        <div className="text-xs text-mint-ink/80 mt-1">{CASHFLOW.deltaNet} vs tháng trước</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-surface shadow-raised p-4">
          <div className="text-xs text-muted">Tổng vào</div>
          <div className="font-display text-lg font-bold text-success tabular-nums mt-1">
            {formatVNDCompact(CASHFLOW.in)}
          </div>
          <div className="text-xs text-muted mt-0.5">{CASHFLOW.deltaIn}</div>
        </div>
        <div className="rounded-lg bg-surface shadow-raised p-4">
          <div className="text-xs text-muted">Tổng ra</div>
          <div className="font-display text-lg font-bold text-danger tabular-nums mt-1">
            {formatVNDCompact(CASHFLOW.out)}
          </div>
          <div className="text-xs text-muted mt-0.5">{CASHFLOW.deltaOut}</div>
        </div>
      </div>

      {/* Thu/Chi 7 ngày gần nhất */}
      <div className="rounded-lg bg-surface shadow-raised p-4">
        <SectionLabel className="mb-3">Thu / Chi 7 ngày gần nhất</SectionLabel>
        <div className="flex items-end gap-2 h-32" role="img" aria-label="Biểu đồ thu chi 7 ngày gần nhất">
          {CASHFLOW.byDay.map((d) => (
            <div key={d.d} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="w-full flex items-end gap-[3px] h-full">
                <div
                  className="flex-1 rounded-t-sm bg-mint"
                  style={{ height: `${Math.round((d.in / maxDay) * 100)}%` }}
                />
                <div
                  className="flex-1 rounded-t-sm bg-danger-soft"
                  style={{ height: `${Math.max(4, Math.round((d.out / maxDay) * 100))}%` }}
                />
              </div>
              <span className="text-[9px] text-muted tabular-nums">{d.d.slice(0, 2)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-mint" /> Thu
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-danger-soft" /> Chi
          </span>
        </div>
      </div>

      {/* Hạng mục chi */}
      <div className="rounded-lg bg-surface shadow-raised p-4">
        <SectionLabel className="mb-3">Hạng mục chi</SectionLabel>
        <div className="space-y-3">
          {CASHFLOW.breakdown.map((b) => (
            <div key={b.name}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className={cn("text-sm truncate", b.name.startsWith("(") ? "text-muted" : "text-ink")}>
                  {b.name}
                </span>
                <span className="text-sm font-semibold text-ink tabular-nums shrink-0">
                  {formatVNDCompact(b.amount)} · {b.pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${b.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <SuggestNote>Lịch âm dương + chart ComposedChart đầy đủ: giữ ở desktop / build thật</SuggestNote>
    </Reveal>
  );
}
