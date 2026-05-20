"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

interface Shortcut {
  key: "expense" | "shift" | "cash-check" | "cash-close" | "report";
  label: string;
  hint: string;
  icon: IconName;
  /** Phase the destination module lands in. Until then, clicks toast a hint. */
  phase: "3B" | "3C" | "ready";
}

const SHORTCUTS: ReadonlyArray<Shortcut> = [
  { key: "expense",    label: "Ghi chi phí",     hint: "Mở form nhập nhanh",       icon: "plus",     phase: "3B" },
  { key: "shift",      label: "Ra/vào ca",        hint: "Ghi nhận lượt làm",        icon: "clock",    phase: "3B" },
  { key: "cash-check", label: "Kiểm két nhanh",   hint: "Đếm két tức thời",         icon: "banknote", phase: "3B" },
  { key: "cash-close", label: "Chốt két",         hint: "Đi theo từng bước",        icon: "lock",     phase: "3C" },
  { key: "report",     label: "In báo cáo",       hint: "Phiếu chốt két",           icon: "printer",  phase: "ready" },
];

interface ShortcutGridProps {
  onGoReports(): void;
}

/**
 * 5 quick-action buttons. In Phase 3A only "Báo cáo chốt két" (report)
 * has a real destination (the reports view); the rest toast a hint about
 * when they land.
 */
export function ShortcutGrid({ onGoReports }: ShortcutGridProps) {
  const { toast } = useToast();
  function handle(s: Shortcut) {
    if (s.key === "report") {
      onGoReports();
      return;
    }
    toast({
      semantic: "info",
      title: s.label,
      message: `Tính năng này sẽ vào ở Phase ${s.phase}.`,
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bảng điều khiển nhanh</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SHORTCUTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => handle(s)}
              className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-4 text-left transition hover:border-border-strong hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
            >
              <Icon name={s.icon} size={20} className="text-ink" />
              <strong className="text-sm font-semibold text-ink">{s.label}</strong>
              <span className="text-xs text-muted">{s.hint}</span>
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
