"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icons";
import type { ViewKey } from "@/features/navigation/navigation";

interface Shortcut {
  key: "expense" | "shift" | "cash-check" | "cash-close" | "report";
  label: string;
  hint: string;
  icon: IconName;
  /** Sidebar view to navigate to when clicked. */
  target: ViewKey;
}

const SHORTCUTS: ReadonlyArray<Shortcut> = [
  { key: "expense",    label: "Ghi chi phí",     hint: "Mở form nhập nhanh",       icon: "plus",     target: "expenses" },
  { key: "shift",      label: "Ra/vào ca",        hint: "Ghi nhận lượt làm",        icon: "clock",    target: "shifts" },
  { key: "cash-check", label: "Kiểm két nhanh",   hint: "Đếm két tức thời",         icon: "banknote", target: "cash" },
  { key: "cash-close", label: "Chốt két",         hint: "Đi theo từng bước",        icon: "lock",     target: "cash" },
  { key: "report",     label: "In báo cáo",       hint: "Phiếu chốt két",           icon: "printer",  target: "reports" },
];

interface ShortcutGridProps {
  onNavigate(view: ViewKey): void;
}

/**
 * 5 quick-action buttons that navigate to their destination module via the
 * parent's view dispatcher. The dashboard widget pattern is "summary +
 * click-through to full module" — these shortcuts are the click-through.
 */
export function ShortcutGrid({ onNavigate }: ShortcutGridProps) {
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
              onClick={() => onNavigate(s.target)}
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
