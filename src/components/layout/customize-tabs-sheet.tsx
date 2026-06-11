"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { MOBILE_TAB_COUNT, type NavItem, type ViewKey } from "@/features/navigation/navigation";

interface CustomizeTabsSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Toàn bộ view user được thấy (visibleNav) — nguồn chọn. */
  items: ReadonlyArray<NavItem>;
  /** Tab hiện tại trên bar (để pre-select đúng thứ tự). */
  current: ReadonlyArray<ViewKey>;
  saving?: boolean;
  onSave(keys: ViewKey[]): void;
  /** Khôi phục mặc định theo role (mobile_tabs = null). */
  onReset(): void;
}

/**
 * Sheet "Tuỳ chỉnh tab" — user tự chọn tối đa 4 đích cho bottom tab bar,
 * theo THỨ TỰ bấm (badge 1→4). Lưu vào profiles.dashboard_preferences
 * .mobile_tabs (per-user); "Khôi phục mặc định" xoá tuỳ chỉnh.
 */
export function CustomizeTabsSheet({
  open,
  onOpenChange,
  items,
  current,
  saving = false,
  onSave,
  onReset,
}: CustomizeTabsSheetProps) {
  const [selected, setSelected] = useState<ViewKey[]>([...current]);

  // Mỗi lần mở sheet, đồng bộ lại từ tab đang dùng.
  useEffect(() => {
    if (open) setSelected([...current]);
  }, [open, current]);

  const full = selected.length >= MOBILE_TAB_COUNT;

  function toggle(key: ViewKey) {
    setSelected((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : prev.length >= MOBILE_TAB_COUNT
          ? prev
          : [...prev, key]
    );
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 md:hidden",
            "bg-surface rounded-t-2xl shadow-modal max-h-[85dvh] overflow-y-auto",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom"
          )}
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="pt-2.5 pb-1.5" aria-hidden>
            <div className="mx-auto w-10 h-1.5 rounded-full bg-border" />
          </div>
          <div className="px-5 pb-1 flex items-center justify-between gap-3">
            <RadixDialog.Title className="font-display text-lg font-bold text-ink">
              Tuỳ chỉnh tab
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Đóng"
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted hover:bg-surface-muted"
              >
                <Icon name="x" size={20} />
              </button>
            </RadixDialog.Close>
          </div>
          <p className="px-5 pb-3 text-xs text-muted">
            Chọn tối đa {MOBILE_TAB_COUNT} chức năng cho thanh dưới — thứ tự bấm = thứ tự tab.
            Phần còn lại luôn nằm trong &quot;Thêm&quot;.
          </p>

          <div className="px-5 space-y-1.5">
            {items.map((item) => {
              const index = selected.indexOf(item.key);
              const isSelected = index >= 0;
              const blocked = !isSelected && full;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggle(item.key)}
                  disabled={blocked}
                  aria-pressed={isSelected}
                  className={cn(
                    "w-full h-12 px-3 rounded-lg border flex items-center gap-3 text-left text-sm transition-colors",
                    isSelected
                      ? "border-border-strong/30 bg-surface-muted/60"
                      : "border-border bg-surface",
                    blocked && "opacity-40"
                  )}
                >
                  <span
                    className={cn(
                      "w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold",
                      isSelected ? "bg-ink text-white" : "border border-border text-muted"
                    )}
                  >
                    {isSelected ? index + 1 : ""}
                  </span>
                  <Icon name={item.icon} size={20} className="text-muted" />
                  <span className="flex-1 font-medium text-ink">{item.label}</span>
                </button>
              );
            })}
          </div>

          {full && (
            <p className="px-5 pt-2 text-xs text-warning">
              Đã đủ {MOBILE_TAB_COUNT} tab — bỏ chọn một mục để đổi.
            </p>
          )}

          <div className="px-5 pt-4 grid grid-cols-[auto_1fr] gap-2">
            <Button variant="ghost" size="lg" onClick={onReset} disabled={saving}>
              Khôi phục mặc định
            </Button>
            <Button
              size="lg"
              loading={saving}
              disabled={selected.length === 0}
              onClick={() => onSave(selected)}
            >
              Lưu ({selected.length}/{MOBILE_TAB_COUNT})
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
