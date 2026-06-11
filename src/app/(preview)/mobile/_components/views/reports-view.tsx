"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { formatNumber, formatVND, formatVNDCompact } from "@/lib/format";
import { SectionLabel, SuggestNote } from "../bits";
import {
  REPORT_TABS,
  REPORT_DATES,
  CASH_CLOSE_REPORT,
  PRODUCT_SUMMARY,
  EXPENSE_BY_CATEGORY,
  PAYROLL_SUMMARY,
  HOURLY_REVENUE,
} from "../../_mock/data";

/**
 * Báo cáo — Tier B: 5 tab cuộn ngang; phiếu chốt két thành card mobile
 * (giữ nút Tải ảnh/In — html-to-image + window.print khi build thật);
 * bảng → card list; chart theo giờ responsive (ẩn bớt nhãn trục).
 */
export function MobileReportsView() {
  const [tab, setTab] = useState(0);
  const [reportIdx, setReportIdx] = useState(0);

  const maxHour = Math.max(...HOURLY_REVENUE.map((h) => h.value));

  return (
    <div className="flex flex-col min-h-full">
      <div className="sticky top-0 z-20 bg-bg-app-from/95 backdrop-blur px-4 pt-3 pb-2 -mb-1">
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Tab báo cáo">
          {REPORT_TABS.map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={tab === i}
              onClick={() => setTab(i)}
              className={cn(
                "h-11 px-4 shrink-0 rounded-full text-sm font-medium transition-colors",
                tab === i ? "bg-ink text-white" : "bg-surface text-muted border border-border"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Reveal key={tab} stagger className="p-4 space-y-3">
        {tab === 0 && (
          <>
            {/* Chọn ngày báo cáo — chip cuộn ngang thay sidebar 320px desktop */}
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-4 px-4">
              {REPORT_DATES.map((r, i) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setReportIdx(i)}
                  className={cn(
                    "h-11 px-4 shrink-0 rounded-full border text-sm font-medium flex items-center gap-2",
                    reportIdx === i ? "bg-ink text-white border-ink" : "bg-surface text-ink border-border"
                  )}
                >
                  {r.label}
                  <span className={cn("text-xs tabular-nums", reportIdx === i ? "text-white/70" : r.diff === 0 ? "text-success" : "text-danger")}>
                    {r.diff === 0 ? "0 ₫" : `${formatNumber(r.diff)} ₫`}
                  </span>
                </button>
              ))}
            </div>

            {/* Phiếu chốt két dạng card */}
            <article className="rounded-lg bg-surface shadow-raised p-4">
              <header className="flex items-center gap-3 pb-3 border-b border-border">
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-widest text-muted">Chill Coffee Garden</div>
                  <h2 className="font-display text-lg font-bold text-ink">Báo cáo chốt két</h2>
                  <div className="text-xs text-muted mt-0.5">{CASH_CLOSE_REPORT.closedAt}</div>
                </div>
                <Badge variant="soft" semantic="success">{CASH_CLOSE_REPORT.status}</Badge>
              </header>
              <dl className="py-3 space-y-1.5 text-sm">
                {CASH_CLOSE_REPORT.rows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-ink tabular-nums">{formatNumber(value)}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                  <dt className="font-semibold text-ink">Chênh lệch</dt>
                  <dd
                    className={cn(
                      "font-display font-bold tabular-nums",
                      CASH_CLOSE_REPORT.difference === 0 ? "text-success" : "text-danger"
                    )}
                  >
                    {formatNumber(CASH_CLOSE_REPORT.difference)} ₫
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted border-t border-border pt-2">
                Ghi chú: {CASH_CLOSE_REPORT.note} · Để lại mai {formatVNDCompact(CASH_CLOSE_REPORT.leaveNextDay)} · Nạp quỹ {formatVNDCompact(CASH_CLOSE_REPORT.safeDeposit)}
              </p>
            </article>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" leadingIcon={<Icon name="download" size={16} />}>
                Tải ảnh
              </Button>
              <Button size="lg" leadingIcon={<Icon name="printer" size={16} />}>
                In
              </Button>
            </div>
            <SuggestNote>Tải ảnh = html-to-image, In = window.print (giữ nguyên khi build thật)</SuggestNote>
          </>
        )}

        {tab === 1 && (
          <>
            <SectionLabel>Tiêu thụ theo nguyên liệu (tuần này)</SectionLabel>
            {[
              ["Cà phê hạt Robusta", "2.450 g", "138 đơn"],
              ["Sữa tươi", "3.200 ml", "74 đơn"],
              ["Sữa đặc", "1.890 ml", "96 đơn"],
              ["Đường nước", "1.150 ml", "187 đơn"],
              ["Trân châu đen", "920 g", "33 đơn"],
            ].map(([name, qty, orders]) => (
              <article key={name} className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3">
                <span className="flex-1 text-sm font-medium text-ink truncate">{name}</span>
                <span className="text-sm text-ink tabular-nums">{qty}</span>
                <span className="text-xs text-muted">{orders}</span>
              </article>
            ))}
          </>
        )}

        {tab === 2 && (
          <>
            <SectionLabel>Doanh số theo sản phẩm (tuần này)</SectionLabel>
            {PRODUCT_SUMMARY.map((p) => (
              <article key={p.name} className="rounded-lg bg-surface shadow-raised px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-sm font-medium text-ink truncate">{p.name}</span>
                  <span className="text-sm font-semibold text-ink tabular-nums">{formatVNDCompact(p.revenue)}</span>
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {p.category} · {p.qty} ly
                </div>
              </article>
            ))}
          </>
        )}

        {tab === 3 && (
          <>
            <SectionLabel>Chi phí theo hạng mục</SectionLabel>
            {EXPENSE_BY_CATEGORY.map((c) => (
              <article key={c.name} className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3">
                <span className="flex-1 text-sm font-medium text-ink truncate">{c.name}</span>
                <span className="text-xs text-muted">{c.count} lần</span>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatVNDCompact(c.amount)}</span>
              </article>
            ))}
            <SectionLabel className="pt-2">Lương theo nhân viên</SectionLabel>
            {PAYROLL_SUMMARY.map((p) => (
              <article key={p.name} className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{p.name}</div>
                  <div className="text-xs text-muted mt-0.5">{p.shifts} ca · {p.hours}</div>
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatVNDCompact(p.total)}</span>
              </article>
            ))}
          </>
        )}

        {tab === 4 && (
          <>
            <div className="rounded-lg bg-surface shadow-raised p-4">
              <div className="flex items-center justify-between mb-3">
                <SectionLabel>Doanh thu theo giờ</SectionLabel>
                <Badge variant="soft" semantic="success">Cao điểm 19–20h</Badge>
              </div>
              {/* Bar chart thuần CSS — Recharts responsive khi build thật */}
              <div className="flex items-end gap-1 h-36" role="img" aria-label="Biểu đồ doanh thu theo giờ, cao điểm 19 đến 20 giờ">
                {HOURLY_REVENUE.map((h) => (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div
                      className={cn(
                        "w-full rounded-t-sm",
                        h.value === maxHour ? "bg-accent" : "bg-peach"
                      )}
                      style={{ height: `${Math.round((h.value / maxHour) * 100)}%` }}
                    />
                    {/* Mobile: chỉ hiện nhãn mỗi 3 giờ — pattern "ẩn bớt nhãn trục" */}
                    <span className="text-[9px] text-muted tabular-nums">
                      {Number(h.hour) % 3 === 0 ? h.hour : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <SuggestNote>Build thật: Recharts ResponsiveContainer, tick 3h, font 10px</SuggestNote>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-mint p-4">
                <div className="text-xs font-medium text-mint-ink">Tổng doanh thu</div>
                <div className="font-display text-xl font-bold text-mint-ink mt-1 tabular-nums">
                  {formatVND(4_850_000)}
                </div>
              </div>
              <div className="rounded-2xl bg-lilac p-4">
                <div className="text-xs font-medium text-lilac-ink">Tổng đơn</div>
                <div className="font-display text-xl font-bold text-lilac-ink mt-1 tabular-nums">187</div>
              </div>
            </div>
          </>
        )}
      </Reveal>
    </div>
  );
}
