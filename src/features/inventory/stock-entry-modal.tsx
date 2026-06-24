"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Combobox } from "@/components/ui/combobox";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useRecordStockCount,
  useRecordStockMovement,
} from "@/hooks/mutations/use-stock-mutations";
import { formatUnit } from "./units";
import type { Ingredient, StockBalance } from "@/lib/types";

type Op = "in" | "count" | "out";
type XuatReason = "manual_adjustment_out" | "waste";

interface StockEntryModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Pre-selected ingredient when launched from a balance-list row click. */
  initialIngredientId?: string | null;
  ingredients: Ingredient[];
  balances: StockBalance[];
}

const XUAT_REASON_OPTIONS: ReadonlyArray<{
  value: XuatReason;
  label: string;
  hint: string;
}> = [
  {
    value: "manual_adjustment_out",
    label: "Sử dụng / Định mức",
    hint: "Xuất dùng cho pha chế, ca làm, sự kiện.",
  },
  {
    value: "waste",
    label: "Hao hụt / Đổ bỏ",
    hint: "Đổ vỡ, hết hạn, hỏng — không sinh ra doanh thu.",
  },
];

/**
 * Unified "Ghi nhận kho" modal — replaces the prior StockMovementModal +
 * StockCountModal pair. Two steps:
 *
 *   Step 1 ("pick"): Pick an operation (Nhập / Kiểm / Xuất). Ingredient
 *     may be pre-selected (row-click entry) or chosen here (toolbar entry).
 *   Step 2 ("form"): Op-specific form (Nhập = qty + notes, Kiểm = actual
 *     qty + live variance + notes, Xuất = qty + reason + notes).
 *
 * On open, state resets. On each close (success, cancel, escape), state
 * resets via the same effect. The ingredient pre-selection survives back
 * navigation between steps — only the op + form fields reset.
 *
 * Reuses existing RPCs:
 *   - record_stock_movement (purchase_received | manual_adjustment_out | waste)
 *   - record_stock_count (count_correction; backend computes the delta)
 */
export function StockEntryModal({
  open,
  onOpenChange,
  initialIngredientId,
  ingredients,
  balances,
}: StockEntryModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const recordMovementM = useRecordStockMovement(supabase);
  const recordCountM = useRecordStockCount(supabase);

  const [step, setStep] = useState<"pick" | "form">("pick");
  const [op, setOp] = useState<Op | null>(null);
  const [ingredientId, setIngredientId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [actual, setActual] = useState("");
  const [xuatReason, setXuatReason] = useState<XuatReason>("manual_adjustment_out");
  const [notes, setNotes] = useState("");

  // On open: reset everything; pre-select ingredient if provided.
  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setOp(null);
    setIngredientId(initialIngredientId ?? null);
    setQuantity("");
    setActual("");
    setXuatReason("manual_adjustment_out");
    setNotes("");
  }, [open, initialIngredientId]);

  const balance = useMemo(
    () => balances.find((b) => b.ingredient_id === ingredientId) ?? null,
    [balances, ingredientId]
  );
  const currentBalance = balance?.theoretical_balance ?? 0;
  const unit = balance?.unit ?? "";
  const ingredientName = balance?.name ?? "";

  const isBusy = recordMovementM.isPending || recordCountM.isPending;

  function goBack() {
    setStep("pick");
    setOp(null);
    setQuantity("");
    setActual("");
    setXuatReason("manual_adjustment_out");
    setNotes("");
  }

  function pickOp(next: Op) {
    if (ingredientId === null) return;
    setOp(next);
    if (next === "count") {
      // Default actual = current balance so Kiểm shows "Đúng" until the
      // operator types a different number — matches the prior modal's UX.
      setActual(String(currentBalance));
    }
    setStep("form");
  }

  // ===== Submission handlers =====

  async function submitNhap(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseQty(quantity);
    if (qty === null || qty <= 0 || ingredientId === null) return;
    try {
      await recordMovementM.mutateAsync({
        ingredient_id: ingredientId,
        quantity_delta: qty,
        reason: "purchase_received",
        notes: trimOrNull(notes),
      });
      toast({ semantic: "success", message: "Đã ghi nhận nhập kho." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi nhập kho.",
      });
    }
  }

  async function submitKiem(e: React.FormEvent) {
    e.preventDefault();
    const actualNum = parseQty(actual);
    if (actualNum === null || actualNum < 0 || ingredientId === null) return;
    try {
      await recordCountM.mutateAsync({
        ingredient_id: ingredientId,
        actual_quantity: actualNum,
        notes: trimOrNull(notes),
      });
      toast({ semantic: "success", message: "Đã ghi nhận kiểm kê." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi kiểm kê.",
      });
    }
  }

  async function submitXuat(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseQty(quantity);
    if (qty === null || qty <= 0 || ingredientId === null) return;
    try {
      await recordMovementM.mutateAsync({
        ingredient_id: ingredientId,
        quantity_delta: -qty,
        reason: xuatReason,
        notes: trimOrNull(notes),
      });
      toast({ semantic: "success", message: "Đã ghi nhận xuất kho." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi xuất kho.",
      });
    }
  }

  // ===== Render =====

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        {step === "pick" ? (
          <PickStep
            initialIngredientLocked={initialIngredientId != null}
            ingredients={ingredients}
            balance={balance}
            ingredientId={ingredientId}
            onIngredientChange={setIngredientId}
            onPick={pickOp}
            onCancel={() => onOpenChange(false)}
            isBusy={isBusy}
          />
        ) : op === "in" ? (
          <NhapForm
            ingredientName={ingredientName}
            unit={unit}
            currentBalance={currentBalance}
            quantity={quantity}
            onQuantityChange={setQuantity}
            notes={notes}
            onNotesChange={setNotes}
            onBack={goBack}
            onCancel={() => onOpenChange(false)}
            onSubmit={submitNhap}
            isBusy={isBusy}
          />
        ) : op === "count" ? (
          <KiemForm
            ingredientName={ingredientName}
            unit={unit}
            currentBalance={currentBalance}
            actual={actual}
            onActualChange={setActual}
            notes={notes}
            onNotesChange={setNotes}
            onBack={goBack}
            onCancel={() => onOpenChange(false)}
            onSubmit={submitKiem}
            isBusy={isBusy}
          />
        ) : (
          <XuatForm
            ingredientName={ingredientName}
            unit={unit}
            currentBalance={currentBalance}
            quantity={quantity}
            onQuantityChange={setQuantity}
            reason={xuatReason}
            onReasonChange={setXuatReason}
            notes={notes}
            onNotesChange={setNotes}
            onBack={goBack}
            onCancel={() => onOpenChange(false)}
            onSubmit={submitXuat}
            isBusy={isBusy}
          />
        )}
      </ModalContent>
    </Modal>
  );
}

// ===== Step 1 — pick =====

function PickStep({
  initialIngredientLocked,
  ingredients,
  balance,
  ingredientId,
  onIngredientChange,
  onPick,
  onCancel,
  isBusy,
}: {
  initialIngredientLocked: boolean;
  ingredients: Ingredient[];
  balance: StockBalance | null;
  ingredientId: string | null;
  onIngredientChange(id: string): void;
  onPick(op: Op): void;
  onCancel(): void;
  isBusy: boolean;
}) {
  const canPickOp = ingredientId !== null;
  return (
    <>
      <ModalTitle>Ghi nhận kho</ModalTitle>
      <ModalDescription>
        Chọn nguyên liệu và thao tác bạn muốn ghi nhận.
      </ModalDescription>

      <div className="mt-6 space-y-4">
        {initialIngredientLocked && balance ? (
          <IngredientHeader balance={balance} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">
              Nguyên liệu
            </label>
            <Combobox
              value={ingredientId}
              onValueChange={onIngredientChange}
              disabled={isBusy}
              className="w-full"
              placeholder="Chọn nguyên liệu..."
              searchPlaceholder="Tìm nguyên liệu..."
              emptyText="Chưa có nguyên liệu"
              options={ingredients.map((i) => ({ value: i.id, label: i.name }))}
            />
            {balance && (
              <p className="text-xs text-muted">
                Tồn hiện tại:{" "}
                <span className="font-mono tabular-nums">
                  {balance.theoretical_balance} {formatUnit(balance.unit)}
                </span>
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <OpButton
            disabled={!canPickOp || isBusy}
            onClick={() => onPick("in")}
            icon="arrowDownRight"
            label="Nhập kho"
            semantic="success"
          />
          <OpButton
            disabled={!canPickOp || isBusy}
            onClick={() => onPick("count")}
            icon="clipboardList"
            label="Kiểm kê"
            semantic="neutral"
          />
          <OpButton
            disabled={!canPickOp || isBusy}
            onClick={() => onPick("out")}
            icon="arrowUpRight"
            label="Xuất kho"
            semantic="warning"
          />
        </div>
      </div>

      <ModalActions>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isBusy}>
          Hủy
        </Button>
      </ModalActions>
    </>
  );
}

function IngredientHeader({ balance }: { balance: StockBalance }) {
  const isNegative = balance.theoretical_balance < 0;
  return (
    <div className="rounded-md border border-border bg-surface-muted p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">Nguyên liệu</p>
          <p className="text-sm font-medium text-ink truncate">{balance.name}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Tồn hiện tại</p>
          <p
            className={
              "text-lg font-mono tabular-nums " +
              (isNegative ? "text-danger" : "text-ink")
            }
          >
            {balance.theoretical_balance} {formatUnit(balance.unit)}
          </p>
        </div>
      </div>
    </div>
  );
}

function OpButton({
  disabled,
  onClick,
  icon,
  label,
  semantic,
}: {
  disabled: boolean;
  onClick(): void;
  icon: "arrowDownRight" | "clipboardList" | "arrowUpRight";
  label: string;
  semantic: "success" | "neutral" | "warning";
}) {
  const semanticClass =
    semantic === "success"
      ? "border-success/40 hover:border-success hover:bg-success/5 text-success"
      : semantic === "warning"
      ? "border-warning/40 hover:border-warning hover:bg-warning/5 text-warning"
      : "border-border hover:border-border-strong hover:bg-surface-muted text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "flex flex-col items-center justify-center gap-1.5 rounded-md border p-4 transition-colors " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong " +
        "disabled:cursor-not-allowed disabled:opacity-50 " +
        semanticClass
      }
    >
      <Icon name={icon} size={20} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

// ===== Step 2 forms =====

function FormHeader({
  title,
  ingredientName,
  unit,
  currentBalance,
  onBack,
  disabled,
}: {
  title: string;
  ingredientName: string;
  unit: string;
  currentBalance: number;
  onBack(): void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={disabled}
          className="rounded-md p-1 hover:bg-surface-muted disabled:opacity-50"
          aria-label="Quay lại"
        >
          <Icon name="chevronLeft" size={20} />
        </button>
        <ModalTitle>{title}</ModalTitle>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink truncate">{ingredientName}</p>
        <p className="text-xs text-muted">
          Tồn hiện tại:{" "}
          <span className="font-mono tabular-nums">
            {currentBalance} {formatUnit(unit)}
          </span>
        </p>
      </div>
    </>
  );
}

function NhapForm({
  ingredientName,
  unit,
  currentBalance,
  quantity,
  onQuantityChange,
  notes,
  onNotesChange,
  onBack,
  onCancel,
  onSubmit,
  isBusy,
}: {
  ingredientName: string;
  unit: string;
  currentBalance: number;
  quantity: string;
  onQuantityChange(v: string): void;
  notes: string;
  onNotesChange(v: string): void;
  onBack(): void;
  onCancel(): void;
  onSubmit(e: React.FormEvent): void;
  isBusy: boolean;
}) {
  const qty = parseQty(quantity);
  const valid = qty !== null && qty > 0;
  return (
    <>
      <FormHeader
        title="Nhập kho"
        ingredientName={ingredientName}
        unit={unit}
        currentBalance={currentBalance}
        onBack={onBack}
        disabled={isBusy}
      />
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <TextField
          label={`Số lượng nhập (${formatUnit(unit)})`}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => onQuantityChange(e.target.value)}
          disabled={isBusy}
          placeholder="0"
          helper={
            valid && qty !== null
              ? `Sau khi nhập: ${currentBalance + qty} ${formatUnit(unit)}`
              : undefined
          }
          error={
            quantity.trim() !== "" && !valid
              ? "Số lượng phải lớn hơn 0."
              : undefined
          }
          autoFocus
        />
        <Textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={isBusy}
          rows={2}
          maxLength={500}
          placeholder="Ghi chú (tùy chọn) — VD: nhập từ NCC X, hoá đơn 123..."
          helper="Tùy chọn"
        />
        <ModalActions>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isBusy}>
            Hủy
          </Button>
          <Button type="submit" variant="primary" loading={isBusy} disabled={!valid || isBusy}>
            Lưu
          </Button>
        </ModalActions>
      </form>
    </>
  );
}

function KiemForm({
  ingredientName,
  unit,
  currentBalance,
  actual,
  onActualChange,
  notes,
  onNotesChange,
  onBack,
  onCancel,
  onSubmit,
  isBusy,
}: {
  ingredientName: string;
  unit: string;
  currentBalance: number;
  actual: string;
  onActualChange(v: string): void;
  notes: string;
  onNotesChange(v: string): void;
  onBack(): void;
  onCancel(): void;
  onSubmit(e: React.FormEvent): void;
  isBusy: boolean;
}) {
  const actualNum = parseQty(actual);
  const valid = actualNum !== null && actualNum >= 0;
  const delta = valid && actualNum !== null ? actualNum - currentBalance : null;
  return (
    <>
      <FormHeader
        title="Kiểm kê"
        ingredientName={ingredientName}
        unit={unit}
        currentBalance={currentBalance}
        onBack={onBack}
        disabled={isBusy}
      />
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <TextField
          label={`Số lượng thực tế (${formatUnit(unit)})`}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={actual}
          onChange={(e) => onActualChange(e.target.value)}
          disabled={isBusy}
          placeholder="0"
          error={
            actual.trim() !== "" && !valid
              ? "Số lượng thực tế không thể âm."
              : undefined
          }
          autoFocus
        />
        {delta !== null && (
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted mb-1">Chênh lệch</p>
            {delta === 0 ? (
              <p className="text-sm font-medium text-success">Đúng số</p>
            ) : delta > 0 ? (
              <p className="text-sm font-medium text-success">
                Thừa {delta} {formatUnit(unit)}
              </p>
            ) : (
              <p className="text-sm font-medium text-warning">
                Thiếu {Math.abs(delta)} {formatUnit(unit)}
              </p>
            )}
          </div>
        )}
        <Textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={isBusy}
          rows={2}
          maxLength={500}
          placeholder="Ghi chú (tùy chọn) — VD: kiểm cuối ngày, ca sáng..."
          helper="Tùy chọn"
        />
        <ModalActions>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isBusy}>
            Hủy
          </Button>
          <Button type="submit" variant="primary" loading={isBusy} disabled={!valid || isBusy}>
            Lưu
          </Button>
        </ModalActions>
      </form>
    </>
  );
}

function XuatForm({
  ingredientName,
  unit,
  currentBalance,
  quantity,
  onQuantityChange,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  onBack,
  onCancel,
  onSubmit,
  isBusy,
}: {
  ingredientName: string;
  unit: string;
  currentBalance: number;
  quantity: string;
  onQuantityChange(v: string): void;
  reason: XuatReason;
  onReasonChange(v: XuatReason): void;
  notes: string;
  onNotesChange(v: string): void;
  onBack(): void;
  onCancel(): void;
  onSubmit(e: React.FormEvent): void;
  isBusy: boolean;
}) {
  const qty = parseQty(quantity);
  const valid = qty !== null && qty > 0;
  const wouldGoNegative = valid && qty !== null && qty > currentBalance;
  const reasonHint = XUAT_REASON_OPTIONS.find((r) => r.value === reason)?.hint;
  return (
    <>
      <FormHeader
        title="Xuất kho"
        ingredientName={ingredientName}
        unit={unit}
        currentBalance={currentBalance}
        onBack={onBack}
        disabled={isBusy}
      />
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-ink-2">Lý do</label>
          <div className="grid grid-cols-2 gap-2">
            {XUAT_REASON_OPTIONS.map((opt) => {
              const selected = opt.value === reason;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onReasonChange(opt.value)}
                  disabled={isBusy}
                  className={
                    "rounded-md border px-3 py-2 text-sm transition-colors " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong " +
                    "disabled:cursor-not-allowed disabled:opacity-50 " +
                    (selected
                      ? "border-border-strong bg-surface-muted text-ink font-medium"
                      : "border-border text-ink-2 hover:bg-surface-muted")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {reasonHint && <p className="text-xs text-muted">{reasonHint}</p>}
        </div>

        <TextField
          label={`Số lượng xuất (${formatUnit(unit)})`}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => onQuantityChange(e.target.value)}
          disabled={isBusy}
          placeholder="0"
          helper={
            valid && qty !== null
              ? `Sau khi xuất: ${currentBalance - qty} ${formatUnit(unit)}`
              : undefined
          }
          error={
            quantity.trim() !== "" && !valid
              ? "Số lượng phải lớn hơn 0."
              : undefined
          }
          autoFocus
        />

        {wouldGoNegative && (
          <AlertBanner variant="warning">
            Xuất {qty} {formatUnit(unit)} sẽ làm tồn âm ({currentBalance - (qty ?? 0)}{" "}
            {formatUnit(unit)}). Vẫn lưu được, nhưng nên kiểm lại số liệu.
          </AlertBanner>
        )}

        <Textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={isBusy}
          rows={2}
          maxLength={500}
          placeholder={
            reason === "waste"
              ? "Ghi chú (khuyến nghị) — VD: đổ vỡ, hết hạn..."
              : "Ghi chú (tùy chọn) — VD: dùng cho ca sáng, sự kiện..."
          }
          helper="Tùy chọn"
        />

        <ModalActions>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isBusy}>
            Hủy
          </Button>
          <Button type="submit" variant="primary" loading={isBusy} disabled={!valid || isBusy}>
            Lưu
          </Button>
        </ModalActions>
      </form>
    </>
  );
}

// ===== Pure helpers =====

function parseQty(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return n;
}

function trimOrNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}
