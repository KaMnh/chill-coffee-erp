# Sidebar Functional Groups — Design

**Date:** 2026-06-09
**Status:** Approved (pending implementation plan)

## Mục tiêu

Nhóm các mục sidebar (hiện đang đổ phẳng vào một section `"Vận hành"` duy nhất)
thành các **nhóm chức năng cố định** theo dòng tiền, để sidebar dễ quét mắt và
phản ánh đúng cấu trúc nghiệp vụ của quán.

Nhóm là **metadata cố định trong code** — không cấu hình được per-user, không cần
migration DB.

## Hiện trạng

- `src/features/navigation/navigation.ts` định nghĩa `NAV_ITEMS` — danh sách phẳng
  **11 view** (`dashboard, expenses, shifts, cash, safe, handover, inventory,
  reports, pivot, cashflow, settings`). *(Cập nhật theo `origin/main`: view
  `cashflow` "Dòng tiền" được thêm sau khi spec gốc viết trên base `phase-6a` cũ;
  feature này nay build trên `origin/main`.)*
- `getVisibleNav(account, settings)` trả về `NAV_ITEMS.filter(...)` — tức **theo thứ
  tự cố định của `NAV_ITEMS`**, KHÔNG theo thứ tự user. `sidebar_config` chỉ là TẬP
  key bật/tắt (form Thiết lập là ma trận checkbox, không reorder) — không mang thông
  tin thứ tự. Sidebar hiện tại đã render theo thứ tự `NAV_ITEMS`.
- `src/app/page.tsx` render toàn bộ `visibleNav` trong **một** `<SidebarSection
  label="Vận hành">`.
- `src/components/layout/sidebar.tsx` đã có `SidebarSection` nhận `label?: string`
  optional — đã sẵn sàng render nhiều nhóm.
- Form Thiết lập (`sidebar-config-form.tsx`, `user-sidebar-config-modal.tsx`) chỉ
  đọc `.key / .label / .roles` của `NAV_ITEMS` → thêm field `group` **không phá vỡ**
  các màn này.
- **Chưa có** test cho `navigation.ts`.

## Taxonomy nhóm (Phương án C — dòng tiền)

| Nhóm (`NavGroupKey`) | Label         | Các view             |
|----------------------|---------------|----------------------|
| `overview`           | Tổng quan     | dashboard, cashflow  |
| `cashflow`           | Thu – Chi – Quỹ | cash, expenses, safe |
| `staff`              | Nhân sự & Ca  | shifts, handover     |
| `inventory`          | Kho hàng      | inventory            |
| `reports`            | Báo cáo       | reports, pivot       |
| `system`             | Thiết lập     | settings             |

> **Lưu ý đặt tên (dễ nhầm):** view `cashflow` ("Dòng tiền", owner/manager) thuộc
> **nhóm `overview`**, KHÔNG thuộc nhóm tên `cashflow` ("Thu – Chi – Quỹ"). Trùng tên
> giữa một `ViewKey` và một `NavGroupKey` là vô hại về type (khác trường: `item.key`
> vs `item.group`) — chỉ cần gán đúng `group: "overview"` cho item `cashflow`.

## Thay đổi

### 1. `src/features/navigation/navigation.ts`

Thêm:

```ts
export type NavGroupKey =
  | "overview" | "cashflow" | "staff" | "inventory" | "reports" | "system";

export interface NavGroup {
  key: NavGroupKey;
  label: string;
}

// Thứ tự nhóm cố định — render theo đúng thứ tự mảng này.
export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  { key: "overview",  label: "Tổng quan" },
  { key: "cashflow",  label: "Thu – Chi – Quỹ" },
  { key: "staff",     label: "Nhân sự & Ca" },
  { key: "inventory", label: "Kho hàng" },
  { key: "reports",   label: "Báo cáo" },
  { key: "system",    label: "Thiết lập" },
];

export interface NavGroupWithItems extends NavGroup {
  items: ReadonlyArray<NavItem>;
}
```

Thêm field `group: NavGroupKey` vào `NavItem` và gán cho từng item trong `NAV_ITEMS`
theo bảng taxonomy trên.

Thêm helper:

```ts
export function getGroupedNav(
  account: Account | null,
  settings: AppSettings
): ReadonlyArray<NavGroupWithItems> {
  const visible = getVisibleNav(account, settings);
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: visible.filter((item) => item.group === group.key),
    }))
    .filter((group) => group.items.length > 0);
}
```

### 2. `src/app/page.tsx`

Thay khối render single-section bằng vòng lặp qua `getGroupedNav(...)`:

```tsx
{groupedNav.map((group) => (
  <SidebarSection key={group.key} label={group.label}>
    {group.items.map((item) => (
      <NavItem
        key={item.key}
        icon={item.icon}
        label={item.label}
        active={view === item.key}
        onClick={() => handleNavClick(item.key)}
      />
    ))}
  </SidebarSection>
))}
```

(`groupedNav` thay cho `visibleNav` ở nơi đang gọi `getVisibleNav`.)

### 3. Test mới `src/features/navigation/navigation.test.ts`

`getGroupedNav` phải:
- Nhóm đúng mỗi item vào `NavGroupKey` tương ứng.
- Trả về nhóm theo **đúng thứ tự** `NAV_GROUPS` (cross-group order cố định).
- **Ẩn nhóm rỗng** — ví dụ `employee_viewer` (chỉ thấy `dashboard`) → kết quả chỉ có
  duy nhất nhóm `overview`.
- **Thứ tự trong nhóm = thứ tự `NAV_ITEMS`**: nhóm `cashflow` ("Thu – Chi – Quỹ") trả
  về đúng `[expenses, cash, safe]` (thứ tự `NAV_ITEMS`), KHÔNG phụ thuộc thứ tự liệt kê
  trong `sidebar_config` (config chỉ bật/tắt, không reorder).
- `owner` mặc định → đủ 6 nhóm.
- View `cashflow` ("Dòng tiền") xếp vào nhóm `overview` (cùng `dashboard`), KHÔNG lọt
  vào nhóm tên `cashflow`; với `owner`, nhóm `overview` có đúng 2 mục
  (`dashboard`, `cashflow`).

## Quyết định hành vi

- **Cross-group order**: cố định theo `NAV_GROUPS`.
- **Thứ tự trong nhóm**: theo thứ tự cố định của `NAV_ITEMS` (không có "thứ tự user" vì
  `sidebar_config` chỉ bật/tắt). Vd nhóm `cashflow` render theo `NAV_ITEMS` =
  `expenses, cash, safe`.
- **Nhóm rỗng tự ẩn** (không render section trống).
- **Label đồng nhất**: mọi nhóm đều hiển thị label, kể cả nhóm chỉ có 1 mục
  (`overview`, `inventory`, `system`).

## Ngoài phạm vi (YAGNI)

- Không cho cấu hình nhóm per-user / per-role.
- Không thêm nhóm collapse/expand.
- Không đổi `sidebar-config-form` / `user-sidebar-config-modal`.
- Không migration DB.

## Rủi ro / lưu ý

- `getVisibleNav` vẫn được giữ và tái dùng bởi `getGroupedNav`; các nơi khác đang gọi
  `getVisibleNav` / `canSee` không bị ảnh hưởng.
- Thêm field bắt buộc `group` vào `NavItem` → TypeScript ép gán đủ cho cả 11 item,
  tránh sót.
