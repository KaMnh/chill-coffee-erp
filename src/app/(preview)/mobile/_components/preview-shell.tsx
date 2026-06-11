"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { PhoneFrame } from "./phone-frame";
import { MobileApp } from "./mobile-app";
import { PreviewContext } from "./bits";
import type { PreviewRole, Scenario } from "../_mock/data";

const ROLES: Array<{ value: PreviewRole; label: string }> = [
  { value: "staff", label: "Nhân viên" },
  { value: "owner", label: "Chủ quán" },
];

const SCENARIOS: Array<{ value: Scenario; label: string }> = [
  { value: "on", label: "Ngày ổn" },
  { value: "warn", label: "Ngày cảnh báo" },
  { value: "loading", label: "Đang tải" },
  { value: "empty", label: "Trống" },
];

/**
 * Trang preview: thanh điều khiển (role + kịch bản) + khung điện thoại.
 * Trên điện thoại thật (<md) khung chiếm full màn — đúng trải nghiệm app.
 */
export function PreviewShell() {
  const [role, setRole] = useState<PreviewRole>("staff");
  const [scenario, setScenario] = useState<Scenario>("on");

  return (
    // Mobile thật: flex column cao đúng 100dvh (chips + frame), không cuộn trang.
    <main className="h-[100dvh] flex flex-col overflow-hidden md:h-auto md:min-h-screen md:overflow-visible md:block md:p-8">
      <div className="mx-auto w-full max-w-5xl flex-1 min-h-0 flex flex-col md:flex-none md:grid md:grid-cols-[260px_1fr] md:gap-10 md:items-start">
        {/* Panel điều khiển — ẩn trên điện thoại thật để nhường chỗ cho app */}
        <aside className="hidden md:block space-y-6 sticky top-8">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Mobile preview</h1>
            <p className="text-sm text-muted mt-1">
              Mockup điện thoại cho 11 view + đăng nhập. Mock data — không gọi DB/API.
            </p>
          </div>

          <Segmented<PreviewRole> label="Vai trò" options={ROLES} value={role} onChange={setRole} />
          <Segmented<Scenario> label="Kịch bản" options={SCENARIOS} value={scenario} onChange={setScenario} />

          <div className="space-y-2 text-xs text-muted leading-relaxed">
            <p>
              <Badge variant="soft" semantic="warning" className="mr-1">Đề xuất</Badge>
              = phần chưa có data thật / sẽ làm khi build.
            </p>
            <p>• Đăng xuất (menu avatar) → màn Đăng nhập.</p>
            <p>• Tab &quot;Thêm&quot; → drawer các chức năng còn lại (role-aware).</p>
            <p>• Bật &quot;Giảm chuyển động&quot; trong OS → animation tắt (prefers-reduced-motion).</p>
            <p className="pt-1 border-t border-border">
              Spec: docs/superpowers/specs/2026-06-11-mobile-uiux-design.md
            </p>
          </div>
        </aside>

        {/* Khung điện thoại */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-none md:block">
          {/* Thanh điều khiển gọn cho khi xem trên điện thoại thật */}
          <div className="md:hidden shrink-0 flex gap-2 overflow-x-auto px-3 py-2 bg-surface border-b border-border [scrollbar-width:none]">
            {ROLES.map((r) => (
              <ChipBtn key={r.value} active={role === r.value} onClick={() => setRole(r.value)}>
                {r.label}
              </ChipBtn>
            ))}
            <span className="w-px bg-border shrink-0 my-1" aria-hidden />
            {SCENARIOS.map((s) => (
              <ChipBtn key={s.value} active={scenario === s.value} onClick={() => setScenario(s.value)}>
                {s.label}
              </ChipBtn>
            ))}
          </div>

          <PreviewContext.Provider value={{ role, scenario }}>
            <PhoneFrame>
              <MobileApp />
            </PhoneFrame>
          </PreviewContext.Provider>
        </div>
      </div>
    </main>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange(next: T): void;
}

function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <ChipBtn key={opt.value} active={value === opt.value} onClick={() => onChange(opt.value)}>
            {opt.label}
          </ChipBtn>
        ))}
      </div>
    </div>
  );
}

function ChipBtn({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-11 px-3.5 shrink-0 rounded-full border text-sm font-medium transition-colors",
        active ? "bg-ink text-white border-ink" : "bg-surface text-ink border-border hover:bg-surface-muted"
      )}
    >
      {children}
    </button>
  );
}
