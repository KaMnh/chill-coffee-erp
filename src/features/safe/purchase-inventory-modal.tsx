"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useIngredientsQuery } from "@/hooks/queries";
import { useSafePurchaseInventory } from "@/hooks/mutations/use-safe-mutations";
import { formatVND, moneyFromInput } from "@/lib/format";
import { todayInVN } from "@/lib/datetime";
import type { SafeBalances } from "@/lib/types";
import { IngredientFormModal } from "@/features/inventory/ingredient-form-modal";
import { lineAmount, deriveQuantity } from "@/features/inventory/purchase-math";
import { defaultFundSplit } from "./fund-split";

interface PurchaseInventoryModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  balances: SafeBalances;
}

interface PurchaseRow {
  key: number;
  ingredientId: string;
  qtyStr: string;
  priceStr: string;
  amountStr: string;
}

let rowSeq = 1;
function emptyRow(): PurchaseRow {
  return { key: rowSeq++, ingredientId: "", qtyStr: "", priceStr: "", amountStr: "" };
}

/**
 * Nhập nguyên liệu từ sổ quỹ (F1+F2): form nhiều dòng {NL, SL, đơn giá, thành
 * tiền} với quy đổi 2 CHIỀU (sửa SL/đơn giá → thành tiền; sửa thành tiền →
 * SL = thành tiền / đơn giá). Tổng = Σ thành tiền = số rút sổ quỹ, TÁCH 2 quỹ
 * (CK trước, tiền mặt bù — sửa được, ô kia tự bù). Ô ngày (nhãn lịch sử; số dư
 * trừ ngay). "+ Tạo nguyên liệu mới" mở nested IngredientFormModal; sau khi tạo
 * tự chọn vào dòng đang chờ. Submit → RPC atomic safe_purchase_inventory.
 */
export function PurchaseInventoryModal({ open, onOpenChange, balances }: PurchaseInventoryModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const purchaseM = useSafePurchaseInventory(supabase);
  const ingredientsQuery = useIngredientsQuery(supabase, open);
  const today = todayInVN();

  const [rows, setRows] = useState<PurchaseRow[]>([emptyRow()]);
  const [occurredDate, setOccurredDate] = useState(today);
  const [description, setDescription] = useState("");
  const [cashStr, setCashStr] = useState("");
  const [transferStr, setTransferStr] = useState("");
  const [isIngredientModalOpen, setIngredientModalOpen] = useState(false);
  // Dòng đang chờ nguyên liệu mới (auto-chọn khi list refetch có id mới).
  const [pendingRowKey, setPendingRowKey] = useState<number | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const ingredients = useMemo(
    () => (ingredientsQuery.data ?? []).filter((i) => i.is_active),
    [ingredientsQuery.data]
  );

  useEffect(() => {
    if (open) {
      setRows([emptyRow()]);
      setOccurredDate(todayInVN());
      setDescription("");
      setCashStr("");
      setTransferStr("");
      setPendingRowKey(null);
    }
  }, [open]);

  // Auto-chọn nguyên liệu vừa tạo vào dòng đang chờ.
  useEffect(() => {
    if (pendingRowKey === null) {
      knownIdsRef.current = new Set(ingredients.map((i) => i.id));
      return;
    }
    const fresh = ingredients.find((i) => !knownIdsRef.current.has(i.id));
    if (fresh) {
      setRows((prev) =>
        prev.map((r) => (r.key === pendingRowKey ? { ...r, ingredientId: fresh.id } : r))
      );
      setPendingRowKey(null);
      knownIdsRef.current = new Set(ingredients.map((i) => i.id));
    }
  }, [ingredients, pendingRowKey]);

  const total = useMemo(
    () =>
      Math.round(
        rows.reduce((sum, r) => sum + lineAmount(Number(r.qtyStr) || 0, moneyFromInput(r.priceStr)), 0)
      ),
    [rows]
  );
  const cashAmount = moneyFromInput(cashStr);
  const transferAmount = moneyFromInput(transferStr);

  // Tổng đổi (sửa dòng) → áp lại split mặc định (CK trước, tiền mặt bù).
  useEffect(() => {
    const split = defaultFundSplit(total, balances.transfer);
    setCashStr(split.cash > 0 ? String(split.cash) : "");
    setTransferStr(split.transfer > 0 ? String(split.transfer) : "");
  }, [total, balances.transfer]);

  function updateRow(key: number, patch: Partial<PurchaseRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleSelectIngredient(key: number, id: string) {
    const ing = ingredients.find((i) => i.id === id);
    const row = rows.find((r) => r.key === key);
    if (!ing || !row) return;
    const patch: Partial<PurchaseRow> = { ingredientId: id };
    // Auto-fill đơn giá lần mua gần nhất khi ô giá còn trống.
    if (!row.priceStr && ing.last_unit_price > 0) {
      patch.priceStr = String(ing.last_unit_price);
      const qty = Number(row.qtyStr) || 0;
      if (qty > 0) patch.amountStr = String(Math.round(lineAmount(qty, ing.last_unit_price)));
    }
    updateRow(key, patch);
  }

  function handleQtyChange(key: number, raw: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const amount = lineAmount(Number(raw) || 0, moneyFromInput(row.priceStr));
    updateRow(key, { qtyStr: raw, amountStr: amount > 0 ? String(Math.round(amount)) : "" });
  }

  function handlePriceChange(key: number, raw: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const amount = lineAmount(Number(row.qtyStr) || 0, moneyFromInput(raw));
    updateRow(key, { priceStr: raw, amountStr: amount > 0 ? String(Math.round(amount)) : "" });
  }

  function handleAmountChange(key: number, raw: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const qty = deriveQuantity(moneyFromInput(raw), moneyFromInput(row.priceStr));
    // Giữ tối đa 4 số lẻ (đơn vị kg/lít); bỏ đuôi 0 thừa.
    updateRow(key, {
      amountStr: raw,
      qtyStr: qty > 0 ? String(Number(qty.toFixed(4))) : ""
    });
  }

  function handleTransferChange(raw: string) {
    setTransferStr(raw);
    setCashStr(String(Math.max(0, total - moneyFromInput(raw))));
  }
  function handleCashChange(raw: string) {
    setCashStr(raw);
    setTransferStr(String(Math.max(0, total - moneyFromInput(raw))));
  }

  function openCreateIngredient(rowKey: number) {
    knownIdsRef.current = new Set(ingredients.map((i) => i.id));
    setPendingRowKey(rowKey);
    setIngredientModalOpen(true);
  }

  const rowsValid = rows.every(
    (r) => r.ingredientId && (Number(r.qtyStr) || 0) > 0 && moneyFromInput(r.priceStr) >= 0
  );
  const splitMatchesTotal = cashAmount + transferAmount === total;
  const overCash = cashAmount > balances.cash;
  const overTransfer = transferAmount > balances.transfer;
  const isFutureDate = occurredDate > today;
  const isBusy = purchaseM.isPending;
  const hasError =
    !rowsValid || total <= 0 || !splitMatchesTotal || overCash || overTransfer ||
    isFutureDate || description.length > 500;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasError || isBusy) return;
    try {
      const occurredAt =
        occurredDate === today
          ? undefined
          : new Date(`${occurredDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
      await purchaseM.mutateAsync({
        cashAmount,
        transferAmount,
        lines: rows.map((r) => ({
          ingredient_id: r.ingredientId,
          quantity: Number(r.qtyStr) || 0,
          unit_price: moneyFromInput(r.priceStr)
        })),
        description: description || undefined,
        occurredAt
      });
      toast({
        semantic: "success",
        message: `Đã nhập ${rows.length} nguyên liệu, rút ${formatVND(total)} từ sổ quỹ.`
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không nhập được nguyên liệu."
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,46rem)]">
        <ModalTitle>Nhập nguyên liệu (rút sổ quỹ)</ModalTitle>
        <ModalDescription>
          Quỹ tiền mặt: <strong>{formatVND(balances.cash)}</strong> · Quỹ chuyển khoản:{" "}
          <strong>{formatVND(balances.transfer)}</strong> — trừ quỹ và cộng kho trong 1 giao dịch.
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-3">
            {rows.map((row) => {
              const ing = ingredients.find((i) => i.id === row.ingredientId);
              return (
                <div key={row.key} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-ink-2">Nguyên liệu</label>
                      <Select
                        value={row.ingredientId}
                        onValueChange={(v) => handleSelectIngredient(row.key, v)}
                        disabled={isBusy}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn nguyên liệu..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredients.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name} ({i.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => openCreateIngredient(row.key)}
                      disabled={isBusy}
                      leadingIcon={<Icon name="plus" size={16} />}
                    >
                      Tạo mới
                    </Button>
                    {rows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                        disabled={isBusy}
                        aria-label="Xóa dòng"
                        leadingIcon={<Icon name="trash" size={16} />}
                      >
                        {""}
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <TextField
                      label={`Số lượng${ing ? ` (${ing.unit})` : ""}`}
                      value={row.qtyStr}
                      onChange={(e) => handleQtyChange(row.key, e.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={isBusy}
                    />
                    <TextField
                      label="Đơn giá"
                      value={row.priceStr}
                      onChange={(e) => handlePriceChange(row.key, e.target.value)}
                      inputMode="numeric"
                      placeholder="0"
                      disabled={isBusy}
                      helper={ing && ing.last_unit_price > 0 ? `Lần trước: ${formatVND(ing.last_unit_price)}` : undefined}
                    />
                    <TextField
                      label="Thành tiền"
                      value={row.amountStr}
                      onChange={(e) => handleAmountChange(row.key, e.target.value)}
                      inputMode="numeric"
                      placeholder="0"
                      disabled={isBusy}
                      helper="Sửa được — SL tự quy đổi"
                    />
                  </div>
                </div>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRows((prev) => [...prev, emptyRow()])}
              disabled={isBusy}
              leadingIcon={<Icon name="plus" size={16} />}
            >
              Thêm dòng
            </Button>
          </div>

          <div className="rounded-md border border-border bg-surface-muted p-3 flex items-center justify-between">
            <span className="text-sm text-muted">Tổng rút sổ quỹ</span>
            <strong className="font-display text-lg text-ink tabular-nums">{formatVND(total)}</strong>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Trả từ chuyển khoản"
              value={transferStr}
              onChange={(e) => handleTransferChange(e.target.value)}
              inputMode="numeric"
              placeholder="0"
              disabled={isBusy || total <= 0}
              helper={`Còn ${formatVND(balances.transfer)}`}
              error={overTransfer ? "Vượt quỹ chuyển khoản." : undefined}
            />
            <TextField
              label="Trả từ tiền mặt"
              value={cashStr}
              onChange={(e) => handleCashChange(e.target.value)}
              inputMode="numeric"
              placeholder="0"
              disabled={isBusy || total <= 0}
              helper={`Còn ${formatVND(balances.cash)}`}
              error={overCash ? "Vượt quỹ tiền mặt." : undefined}
            />
          </div>
          {total > 0 && !splitMatchesTotal && (
            <AlertBanner variant="danger">
              Tách quỹ ({formatVND(cashAmount + transferAmount)}) chưa khớp tổng ({formatVND(total)}).
            </AlertBanner>
          )}
          {total > 0 && cashAmount + transferAmount === total && balances.cash + balances.transfer < total && (
            <AlertBanner variant="danger">Tổng quỹ không đủ cho đơn nhập này.</AlertBanner>
          )}

          <TextField
            label="Ngày nhập"
            type="date"
            value={occurredDate}
            onChange={(e) => setOccurredDate(e.target.value)}
            disabled={isBusy}
            max={today}
            helper="Ghi muộn đơn đã mua: chọn ngày quá khứ — số dư vẫn trừ ngay."
            error={isFutureDate ? "Không được chọn ngày tương lai." : undefined}
          />
          <Textarea
            label="Mô tả"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="VD: Nhập cà phê + sữa đầu tuần..."
            disabled={isBusy}
            helper="Tùy chọn — ghi vào cả sổ quỹ lẫn lịch sử kho"
          />

          <ModalActions>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={isBusy} disabled={hasError}>
              Nhập kho &amp; rút {total > 0 ? formatVND(total) : ""}
            </Button>
          </ModalActions>
        </form>

        {/* Nested: tạo nguyên liệu mới rồi auto-chọn vào dòng đang chờ */}
        <IngredientFormModal
          open={isIngredientModalOpen}
          onOpenChange={(next) => {
            setIngredientModalOpen(next);
            if (!next && pendingRowKey !== null) {
              // Modal đóng — nếu user hủy (không tạo), effect sẽ không tìm thấy id
              // mới; giữ pending tới lần refetch kế (vô hại) — clear khi đóng modal
              // mà list không đổi sau 1 tick là không cần thiết (YAGNI).
            }
          }}
          editingIngredient={null}
        />
      </ModalContent>
    </Modal>
  );
}
