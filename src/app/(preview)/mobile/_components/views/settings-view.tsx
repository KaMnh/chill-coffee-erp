"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Reveal } from "@/components/ui/reveal";
import { usePreview, SectionLabel, SuggestNote } from "../bits";
import { ACCOUNT_BY_ROLE, ROLE_LABEL } from "../../_mock/data";

/**
 * Thiết lập — Tier B: list row kiểu native (label trái + control phải),
 * section rõ ràng. Các form chi tiết (KiotViet, tài khoản…) mở màn riêng
 * khi build thật.
 */
export function MobileSettingsView() {
  const { role } = usePreview();
  const account = ACCOUNT_BY_ROLE[role];
  const [kiotvietOn, setKiotvietOn] = useState(true);

  return (
    <Reveal stagger className="p-4 space-y-4">
      {/* Tài khoản */}
      <div className="rounded-lg bg-surface shadow-raised p-4 flex items-center gap-3">
        <Avatar size="lg" initials={account.initials} alt={account.name} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink truncate">{account.name}</div>
          <Badge variant="soft" semantic="neutral" className="mt-1">
            {ROLE_LABEL[role]}
          </Badge>
        </div>
        <Icon name="chevronRight" size={16} className="text-muted/50" />
      </div>

      <Section label="Vận hành">
        <Row icon="clock" label="Bồi dưỡng ca dài" detail="≥ 7h · 10.000 ₫" />
        <Row icon="clipboardList" label="Checklist mặc định cuối ngày" detail="6 mục" />
        <Row icon="users" label="Quản lý tài khoản" detail="5 tài khoản" />
        <Row icon="layoutDashboard" label="Sidebar theo role" />
      </Section>

      <Section label="Kết nối">
        <Row
          icon="refreshCw"
          label="KiotViet sync"
          control={<Switch checked={kiotvietOn} onCheckedChange={setKiotvietOn} aria-label="Bật kết nối KiotViet" />}
        />
        <Row icon="upload" label="Webhook" detail="Đã cấu hình" detailSemantic="success" />
        <Row icon="image" label="Nhập Excel KiotViet" />
      </Section>

      <Section label="Dữ liệu (owner)">
        <Row icon="download" label="Backup" detail="11/06 · 4,2 MB" />
        <Row icon="alertTriangle" label="Restore" detail="Destructive" detailSemantic="danger" />
      </Section>

      <SuggestNote>Mỗi row mở màn chi tiết full-screen khi build thật</SuggestNote>
    </Reveal>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionLabel className="mb-1.5 px-1">{label}</SectionLabel>
      <div className="rounded-lg border border-border overflow-hidden bg-surface">{children}</div>
    </div>
  );
}

interface RowProps {
  icon: IconName;
  label: string;
  detail?: string;
  detailSemantic?: "success" | "danger";
  control?: React.ReactNode;
}

function Row({ icon, label, detail, detailSemantic, control }: RowProps) {
  const inner = (
    <>
      <span className="w-9 h-9 shrink-0 rounded-full bg-surface-muted text-ink-2 flex items-center justify-center">
        <Icon name={icon} size={20} />
      </span>
      <span className="flex-1 text-sm font-medium text-ink text-left truncate">{label}</span>
      {detail && (
        <span
          className={cn(
            "text-xs shrink-0",
            detailSemantic === "success" && "text-success",
            detailSemantic === "danger" && "text-danger",
            !detailSemantic && "text-muted"
          )}
        >
          {detail}
        </span>
      )}
      {control ?? <Icon name="chevronRight" size={16} className="text-muted/50 shrink-0" />}
    </>
  );

  // Row có control (Switch) không phải button — tránh nested interactive.
  if (control) {
    return <div className="w-full min-h-12 px-3 py-1.5 flex items-center gap-3 border-b border-border last:border-b-0">{inner}</div>;
  }
  return (
    <button
      type="button"
      className="w-full min-h-12 px-3 py-1.5 flex items-center gap-3 border-b border-border last:border-b-0 active:bg-surface-muted"
    >
      {inner}
    </button>
  );
}
