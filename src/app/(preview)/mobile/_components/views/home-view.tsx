"use client";

import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { CountUp } from "@/components/ui/count-up";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Reveal } from "@/components/ui/reveal";
import { formatVND, formatVNDCompact } from "@/lib/format";
import type { ViewKey } from "@/features/navigation/navigation";
import { usePreview, ViewStates, SectionLabel, SuggestNote } from "../bits";
import { getPreviewData } from "../../_mock/data";

interface MobileHomeViewProps {
  onNavigate(view: ViewKey): void;
}

/**
 * Bảng vận hành — Tier A, 1 cột stack.
 *
 * Nhân viên: KPI 2-up → shortcut 2 cột → bàn giao → sales feed → sổ chi → tồn kho.
 * Chủ quán (thứ tự ưu tiên thị giác): Tin được (sync) → Tiền (KPI) →
 * Thanh khoản (két + sổ quỹ) → Hiệu quả → Cảnh báo (chỉ hiện khi vượt ngưỡng).
 */
export function MobileHomeView({ onNavigate }: MobileHomeViewProps) {
  const { role, scenario } = usePreview();
  const d = getPreviewData(scenario).dashboard;
  const isOwner = role === "owner";

  const skeleton = (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton height="6.5rem" rounded="lg" />
        <Skeleton height="6.5rem" rounded="lg" />
      </div>
      <Skeleton height="3rem" rounded="lg" />
      <Skeleton height="10rem" rounded="lg" />
      <Skeleton height="10rem" rounded="lg" />
    </div>
  );

  const empty = (
    <div className="p-4">
      <EmptyState
        icon="layoutDashboard"
        title="Chưa có dữ liệu hôm nay"
        subtitle="Sau khi sync POS hoặc nhập liệu, bảng vận hành sẽ hiện ở đây."
        dashedBorder
      />
    </div>
  );

  const warnings: Array<{ icon: IconName; text: string; view: ViewKey }> = [];
  if (scenario === "warn") {
    if (d.cashDiff !== 0) warnings.push({ icon: "banknote", text: `Kiểm két gần nhất lệch ${formatVND(d.cashDiff)}`, view: "cash" });
    if (d.staffNotCheckedOut > 0) warnings.push({ icon: "users", text: `${d.staffNotCheckedOut} nhân viên chưa check-out`, view: "shifts" });
    const lowCount = d.stock.filter((s) => s.low || s.negative).length;
    if (lowCount > 0) warnings.push({ icon: "package", text: `${lowCount} nguyên liệu sắp hết / âm kho`, view: "inventory" });
  }

  /* Khối tái dùng */

  const syncChip = (
    <div className="flex items-center gap-2">
      <Badge variant="soft" semantic={d.syncOk ? "success" : "danger"} withDot>
        {d.syncOk ? `POS sync OK · ${d.syncAt}` : `POS sync lỗi · ${d.syncAt}`}
      </Badge>
      <span className="text-xs text-muted">KiotViet</span>
    </div>
  );

  const kpis = (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        color="mint"
        title="Thu POS"
        subtitle="Tổng doanh thu"
        value={<CountUp value={d.totalSales} format={formatVNDCompact} />}
        className="min-h-[96px] p-4"
      />
      <StatCard
        color="peach"
        title="Tổng chi"
        subtitle="Hôm nay"
        value={<CountUp value={d.totalExpenses} format={formatVNDCompact} />}
        className="min-h-[96px] p-4"
      />
    </div>
  );

  // KPI phụ: hàng chip cuộn ngang (pattern "KPI chip cuộn ngang").
  const kpiChips = (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 [scrollbar-width:none]">
      {([
        ["Lương đã phát", formatVNDCompact(d.payrollPaid), "lilac"],
        ["Đang trong ca", `${d.activeStaff} người`, "blue"],
        ["Giờ cao điểm", d.peakHour, "mint"],
      ] as Array<[string, string, "lilac" | "blue" | "mint"]>).map(([label, value, color]) => (
        <div
          key={label}
          className={cn(
            "shrink-0 rounded-full px-4 h-11 flex items-center gap-2",
            color === "lilac" && "bg-lilac text-lilac-ink",
            color === "blue" && "bg-blue text-blue-ink",
            color === "mint" && "bg-mint text-mint-ink"
          )}
        >
          <span className="text-xs">{label}</span>
          <span className="text-sm font-bold tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );

  const liquidity = (
    <div className="rounded-lg bg-surface shadow-raised p-4">
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Thanh khoản</SectionLabel>
        <SuggestNote />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => onNavigate("cash")} className="text-left">
          <div className="text-xs text-muted">Tiền két hiện tại</div>
          <div className="font-display text-xl font-bold text-ink tabular-nums">{formatVND(d.drawerNow)}</div>
        </button>
        <button type="button" onClick={() => onNavigate("safe")} className="text-left">
          <div className="text-xs text-muted">Tổng sổ quỹ</div>
          <div className="font-display text-xl font-bold text-ink tabular-nums">{formatVND(d.safeTotal)}</div>
        </button>
      </div>
    </div>
  );

  const shortcuts = (
    <div className="grid grid-cols-2 gap-2">
      {([
        ["Ghi chi phí", "plus", "expenses"],
        ["Ra/vào ca", "clock", "shifts"],
        ["Chốt két", "banknote", "cash"],
        ["In báo cáo", "printer", "reports"],
      ] as Array<[string, IconName, ViewKey]>).map(([label, icon, view]) => (
        <button
          key={label}
          type="button"
          onClick={() => onNavigate(view)}
          className="h-14 rounded-lg bg-surface shadow-raised px-4 flex items-center gap-3 text-left active:bg-surface-muted"
        >
          <span className="w-9 h-9 rounded-full bg-accent-soft text-accent-dark flex items-center justify-center">
            <Icon name={icon} size={20} />
          </span>
          <span className="text-sm font-medium text-ink">{label}</span>
        </button>
      ))}
    </div>
  );

  const handoverCard = (
    <button
      type="button"
      onClick={() => onNavigate("handover")}
      className="w-full rounded-lg bg-surface shadow-raised p-4 text-left"
    >
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Sổ bàn giao</SectionLabel>
        <Badge variant="soft" semantic={d.handoverDone === d.handoverTotal ? "success" : "warning"}>
          {d.handoverDone}/{d.handoverTotal} việc
        </Badge>
      </div>
      <ProgressBar value={Math.round((d.handoverDone / d.handoverTotal) * 100)} />
    </button>
  );

  const salesFeed = (
    <div className="rounded-lg bg-surface shadow-raised p-4">
      <div className="flex items-center justify-between mb-1">
        <SectionLabel>Thu từ KiotViet</SectionLabel>
        <span className="text-sm font-semibold text-ink tabular-nums">{formatVND(d.totalSales)}</span>
      </div>
      <div className="divide-y divide-border">
        {d.salesFeed.map((s) => (
          <div key={s.code} className="py-2.5 flex items-center gap-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink truncate">{s.code}</div>
              <div className="text-xs text-muted">{s.seller} · {s.time}</div>
            </div>
            <Badge variant="soft" semantic={s.method === "Tiền mặt" ? "neutral" : "success"}>{s.method}</Badge>
            <span className="text-sm font-semibold text-ink tabular-nums">{formatVNDCompact(s.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const expenseLog = (
    <div className="rounded-lg bg-surface shadow-raised p-4">
      <div className="flex items-center justify-between mb-1">
        <SectionLabel>Sổ chi trong ngày</SectionLabel>
        <span className="text-sm font-semibold text-ink tabular-nums">{formatVND(d.totalExpenses)}</span>
      </div>
      <div className="divide-y divide-border">
        {d.expenseLog.map((e) => (
          <div key={e.desc} className="py-2.5 flex items-center gap-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink truncate">{e.desc}</div>
              <div className="text-xs text-muted">{e.category} · {e.time}</div>
            </div>
            <span className="text-sm font-semibold text-ink tabular-nums">{formatVNDCompact(e.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const stockCard = (
    <div className="rounded-lg bg-surface shadow-raised p-4">
      <SectionLabel className="mb-1">Tồn kho cần chú ý</SectionLabel>
      <div className="divide-y divide-border">
        {d.stock.map((s) => (
          <div key={s.name} className="py-2.5 flex items-center gap-2.5">
            <span className="flex-1 text-sm text-ink truncate">{s.name}</span>
            <span className={cn("text-sm tabular-nums", s.negative ? "text-danger font-semibold" : "text-muted")}>{s.qty}</span>
            {s.negative && <Badge variant="soft" semantic="danger">Âm</Badge>}
            {s.low && <Badge variant="soft" semantic="warning">Sắp hết</Badge>}
          </div>
        ))}
      </div>
    </div>
  );

  const warningsBlock = warnings.length > 0 && (
    <div className="space-y-2">
      <SectionLabel>Cảnh báo</SectionLabel>
      {warnings.map((w) => (
        <button key={w.text} type="button" onClick={() => onNavigate(w.view)} className="w-full text-left">
          <AlertBanner variant="warning">
            <span className="inline-flex items-center gap-2">{w.text}</span>
          </AlertBanner>
        </button>
      ))}
    </div>
  );

  return (
    <ViewStates scenario={scenario} skeleton={skeleton} empty={empty}>
      <Reveal stagger className="p-4 space-y-4">
        {isOwner ? (
          // Owner: Tin được → Tiền → Thanh khoản → Hiệu quả → Cảnh báo
          <>
            {syncChip}
            {kpis}
            {liquidity}
            {kpiChips}
            {warningsBlock}
            {salesFeed}
            {expenseLog}
          </>
        ) : (
          // Nhân viên: thao tác vận hành lên trước
          <>
            {scenario === "warn" && !d.syncOk && (
              <AlertBanner variant="danger" title="POS sync lỗi.">
                Lần sync gần nhất {d.syncAt}. Bấm nút đồng bộ ở thanh trên.
              </AlertBanner>
            )}
            {kpis}
            {kpiChips}
            {shortcuts}
            {handoverCard}
            {salesFeed}
            {expenseLog}
            {stockCard}
          </>
        )}
      </Reveal>
    </ViewStates>
  );
}
