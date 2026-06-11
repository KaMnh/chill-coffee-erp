"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Reveal } from "@/components/ui/reveal";
import { formatVND } from "@/lib/format";
import { usePreview, SectionLabel } from "../bits";
import { getPreviewData, PAYROLL_ROWS } from "../../_mock/data";

/**
 * Ca & lương — Tier B: nhân viên = card list, nút Vào ca/Ra ca lớn,
 * lương theo lượt = section gập được.
 */
export function MobileShiftsView() {
  const { scenario } = usePreview();
  const employees = getPreviewData(scenario).shiftEmployees;
  const [payrollOpen, setPayrollOpen] = useState(true);

  const working = employees.filter((e) => e.status === "in");
  const rest = employees.filter((e) => e.status !== "in");
  const payrollTotal = PAYROLL_ROWS.reduce((s, r) => s + r.total, 0);

  return (
    <Reveal stagger className="p-4 space-y-4">
      <div>
        <SectionLabel className="mb-2">Đang làm việc · {working.length}</SectionLabel>
        <div className="space-y-2">
          {working.map((e) => (
            <article key={e.name} className="rounded-lg bg-surface shadow-raised p-3">
              <div className="flex items-center gap-3">
                <Avatar size="md" initials={e.name.split(" ").slice(-1)[0].slice(0, 2)} alt={e.name} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{e.name}</div>
                  <div className="text-xs text-muted">
                    {e.position} · {formatVND(e.rate)}/giờ
                  </div>
                </div>
                <Badge variant="soft" semantic="success" withDot>Từ {e.since}</Badge>
              </div>
              <Button variant="secondary" size="lg" className="w-full mt-3">
                Ra ca
              </Button>
            </article>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel className="mb-2">Chưa vào ca / đã ra ca · {rest.length}</SectionLabel>
        <div className="space-y-2">
          {rest.map((e) => (
            <article key={e.name} className="rounded-lg bg-surface shadow-raised p-3">
              <div className="flex items-center gap-3">
                <Avatar size="md" initials={e.name.split(" ").slice(-1)[0].slice(0, 2)} alt={e.name} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{e.name}</div>
                  <div className="text-xs text-muted">
                    {e.position} · {formatVND(e.rate)}/giờ
                  </div>
                </div>
                {e.status === "out" ? (
                  <Badge variant="soft" semantic="neutral">Đã ra ca · {e.since}</Badge>
                ) : (
                  <Badge variant="soft" semantic="warning">Chưa vào</Badge>
                )}
              </div>
              {e.status === "none" && (
                <Button size="lg" className="w-full mt-3">
                  Vào ca
                </Button>
              )}
            </article>
          ))}
        </div>
      </div>

      {/* Lương theo lượt — gập được */}
      <div className="rounded-lg bg-surface shadow-raised overflow-hidden">
        <button
          type="button"
          onClick={() => setPayrollOpen((v) => !v)}
          aria-expanded={payrollOpen}
          className="w-full p-4 flex items-center gap-3 text-left"
        >
          <div className="flex-1">
            <SectionLabel>Lương theo lượt</SectionLabel>
            <div className="font-display text-lg font-bold text-ink tabular-nums mt-0.5">
              {formatVND(payrollTotal)}
            </div>
          </div>
          <Icon
            name="chevronDown"
            size={16}
            className={cn("text-muted/60 transition-transform", payrollOpen && "rotate-180")}
          />
        </button>
        {payrollOpen && (
          <div className="border-t border-border divide-y divide-border">
            {PAYROLL_ROWS.map((r) => (
              <div key={r.name} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{r.name}</div>
                  <div className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
                    {r.duration} · Bồi dưỡng {formatVND(r.bonus)}
                    {r.edited && (
                      <Badge variant="soft" semantic="warning">Đã sửa</Badge>
                    )}
                  </div>
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatVND(r.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Reveal>
  );
}
