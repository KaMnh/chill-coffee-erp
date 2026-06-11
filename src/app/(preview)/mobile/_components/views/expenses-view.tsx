"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/text-field";
import { Reveal } from "@/components/ui/reveal";
import { useToast } from "@/components/ui/toast";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import { formatVND, formatVNDCompact } from "@/lib/format";
import { Sheet } from "../sheet";
import { usePreview, ViewStates, SectionLabel, MoneyField, Chip } from "../bits";
import { getPreviewData, EXPENSE_CATEGORIES, EXPENSE_TEMPLATES, type ExpenseRow } from "../../_mock/data";

/**
 * Chi phí — Tier A, form-first: FAB "＋ Thêm chi phí" mở bottom sheet
 * (số tiền lớn numeric keypad, hạng mục dạng chip, mẫu nhanh cuộn ngang);
 * lịch sử trong ngày = card list bên dưới.
 */
export function MobileExpensesView() {
  const { scenario } = usePreview();
  const { toast } = useToast();
  const initial = getPreviewData(scenario).expenses;

  const [rows, setRows] = useState<ExpenseRow[]>(initial);
  const [formOpen, setFormOpen] = useState(false);

  // Form state trong sheet.
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [desc, setDesc] = useState("");

  const total = rows.reduce((s, r) => s + r.amount, 0);

  const fabRef = useRef<HTMLButtonElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !fabRef.current) return;
      gsap.from(fabRef.current, { scale: 0, duration: DUR.base, ease: "back.out(1.7)", delay: 0.15 });
    },
    { scope: fabRef }
  );

  function applyTemplate(t: (typeof EXPENSE_TEMPLATES)[number]) {
    setAmount(t.price);
    setDesc(`${t.label} 1 ${t.unit}`);
    setCategory(t.label === "Gas đổi bình" ? "Vận hành" : "Nguyên liệu");
  }

  function save() {
    if (amount === 0 || desc.trim() === "") return;
    const time = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    setRows((prev) => [{ desc: desc.trim(), category, time, amount }, ...prev]);
    setFormOpen(false);
    setAmount(0);
    setDesc("");
    toast({ semantic: "success", message: `Đã lưu khoản chi ${formatVND(amount)}.` });
  }

  const skeleton = (
    <div className="p-4 space-y-3">
      <Skeleton height="4.5rem" rounded="lg" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} height="4rem" rounded="lg" />
      ))}
    </div>
  );

  const empty = (
    <div className="p-4">
      <EmptyState
        icon="wallet"
        title="Chưa có khoản chi"
        subtitle="Bấm nút ＋ để ghi khoản chi đầu tiên trong ngày."
        action={<Button size="lg" onClick={() => setFormOpen(true)}>＋ Thêm chi phí</Button>}
        dashedBorder
      />
    </div>
  );

  return (
    <ViewStates scenario={scenario} skeleton={skeleton} empty={empty}>
      <div className="flex flex-col min-h-full">
        <Reveal stagger className="p-4 space-y-4 flex-1">
          {/* Tổng chi hôm nay */}
          <div className="rounded-lg bg-surface shadow-raised p-4 flex items-center justify-between">
            <div>
              <SectionLabel>Tổng chi hôm nay</SectionLabel>
              <div className="font-display text-2xl font-bold text-ink tabular-nums mt-0.5">
                {formatVND(total)}
              </div>
            </div>
            <Badge variant="soft" semantic="neutral">{rows.length} khoản</Badge>
          </div>

          {/* Lịch sử ngày — card list */}
          <div className="space-y-2 pb-20">
            <SectionLabel>Lịch sử ngày</SectionLabel>
            {rows.map((r, i) => (
              <article
                key={`${r.desc}-${i}`}
                className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{r.desc}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {r.category} · {r.time}
                  </div>
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatVNDCompact(r.amount)}</span>
              </article>
            ))}
          </div>
        </Reveal>

        {/* FAB — sticky đáy phải, trong thumb zone */}
        <div className="sticky bottom-4 z-20 mt-auto px-4 flex justify-end pointer-events-none">
          <button
            ref={fabRef}
            type="button"
            onClick={() => setFormOpen(true)}
            aria-label="Thêm chi phí"
            className="pointer-events-auto w-14 h-14 rounded-full bg-accent text-white shadow-modal flex items-center justify-center active:bg-accent-dark"
          >
            <Icon name="plus" size={24} />
          </button>
        </div>

        {/* Sheet form nhập chi */}
        <Sheet open={formOpen} onClose={() => setFormOpen(false)} title="Thêm khoản chi mới" tall>
          <div className="space-y-4">
            {/* Mẫu nhanh — cuộn ngang */}
            <div>
              <SectionLabel className="mb-1.5">Mẫu nhanh</SectionLabel>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-5 px-5 [scrollbar-width:none]">
                {EXPENSE_TEMPLATES.map((t) => (
                  <Chip key={t.label} onClick={() => applyTemplate(t)} className="shrink-0">
                    {t.label} · {formatVNDCompact(t.price)}
                  </Chip>
                ))}
              </div>
            </div>

            <MoneyField label="Số tiền" value={amount} onChange={setAmount} autoFocus />

            {/* Hạng mục dạng chip */}
            <div>
              <SectionLabel className="mb-1.5">Loại chi phí</SectionLabel>
              <div className="flex gap-2 flex-wrap">
                {EXPENSE_CATEGORIES.map((c) => (
                  <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                    {c}
                  </Chip>
                ))}
              </div>
            </div>

            <TextField
              label="Nội dung *"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="VD: Bánh mì, trứng, đá viên…"
              className="text-base h-12"
            />

            <Button
              size="lg"
              className="w-full"
              disabled={amount === 0 || desc.trim() === ""}
              onClick={save}
            >
              Lưu khoản chi · {formatVND(amount)}
            </Button>
          </div>
        </Sheet>
      </div>
    </ViewStates>
  );
}
