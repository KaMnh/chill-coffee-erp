# Chill Manager v4 — Phase 2: Design System & Component Library — Design Spec

> **Spec date:** 2026-05-20
> **Phase:** 2 / 7 (theo master plan `.claude/plans/c-c-c-file-handoff-shimmering-kahan.md`)
> **Branch:** `phase-2-design-system` (tách từ `main` ở `60585c8`, tag `v4-phase-1`)
> **Tiền đề:** Phase 1 hoàn tất — Next.js 15 + Tailwind v4 + full stack Supabase chạy được, schema áp dụng, owner seeded. App hiện chỉ có placeholder page.
> **Đầu ra Phase 2:** Tailwind theme đầy đủ token + thư viện ~35 component theo `design.md` + route `/playground` để đối chiếu thị giác. Vẫn KHÔNG có UI nghiệp vụ — đó là Phase 3.

---

## 1. Bối cảnh

Master plan Phase 2 yêu cầu hai mục tiêu lồng nhau:
1. **Design tokens** — ánh xạ 1-1 từ `design.md` sang Tailwind v4 `@theme` block (radius, border, elevation, spacing, color, typography, icon).
2. **Thư viện component** — ~32 component theo `design.md`, mỗi cái đủ states, dựng trong `src/components/`.

Phase 3 (3A/3B/3C — port + redesign 8 module v3) chỉ **ráp component**; không thêm component mới ở phase đó. Phase 2 đầu tư trước, các phase sau hưởng.

`design.md` (file tại root project) là spec UI có thẩm quyền cao nhất. Mọi quyết định trong tài liệu này tuân thủ hoặc cụ thể hoá từ `design.md`.

---

## 2. Quyết định kiến trúc đã chốt

Qua brainstorm 2026-05-20:

| Quyết định | Lựa chọn | Lý do tóm tắt |
|---|---|---|
| Headless primitive library | **Radix UI raw** | Tách sạch hành vi (Radix lo a11y/keyboard/focus) và style (Tailwind theo design.md). Tránh "mùi" aesthetic của shadcn. |
| Typography | **Manrope** (body) + **Bricolage Grotesque** (display) | Pair editorial, distinctive, hỗ trợ VN diacritic tốt. Tránh Inter (generic AI-vibe). |
| Chart library | **Recharts** | Linh hoạt, declarative React, đủ customize cho bar bo góc trên + tooltip pill đen theo design.md. |
| Scope | **Toàn diện** (~35 component, mọi states) | Thư viện có "bộ mặt" thống nhất; Phase 3 chỉ ráp. |
| Theme | **Light only ship**, structure theme-able | Đúng design.md (light/pastel). Tokens semantic + CSS variables → dark thêm sau bằng cách flip values, không phải sửa component. |
| Animation | **CSS only** (Tailwind transitions) | Đủ cho component states ở Phase 2 (hover/focus/toggle/shimmer). Motion library hoãn sang Phase 3A khi cần orchestrated entrance dashboard. |
| Icons | **lucide-react** (đã có Phase 1) | design.md nói "Lucide style". |
| File org | Flat `src/components/{ui,layout,charts}/**` | Một file/component, gom logical theo category. |
| Test | Đối chiếu thị giác trên `/playground` + `tsc`/`build` clean | Test tự động cho UI logic → Phase 6 hardening. |

---

## 3. Dependencies thêm vào Phase 2

```json
{
  "dependencies": {
    "@radix-ui/react-checkbox": "^1.x",
    "@radix-ui/react-dialog": "^1.x",
    "@radix-ui/react-dropdown-menu": "^2.x",
    "@radix-ui/react-popover": "^1.x",
    "@radix-ui/react-progress": "^1.x",
    "@radix-ui/react-radio-group": "^1.x",
    "@radix-ui/react-scroll-area": "^1.x",
    "@radix-ui/react-select": "^2.x",
    "@radix-ui/react-separator": "^1.x",
    "@radix-ui/react-slider": "^1.x",
    "@radix-ui/react-switch": "^1.x",
    "@radix-ui/react-tabs": "^1.x",
    "@radix-ui/react-toast": "^1.x",
    "@radix-ui/react-tooltip": "^1.x",
    "clsx": "^2.x",
    "recharts": "^2.x",
    "tailwind-merge": "^2.x"
  }
}
```

Tổng **17 package mới** (14 Radix + recharts + clsx + tailwind-merge). Tất cả tree-shakable. Pin major version, để minor/patch flex.

---

## 4. Design tokens (giá trị cụ thể)

Định nghĩa trong `src/app/globals.css` qua `@theme { … }` (canonical Tailwind v4). Mọi component reference token semantic, **không hardcode hex** trong component code.

### 4.1 Radius

```css
@theme {
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-2xl: 32px;
  --radius-full: 9999px;
}
```
Tailwind sinh utility: `rounded-xs`, `rounded-sm`, …, `rounded-2xl`, `rounded-full`.

### 4.2 Border thickness

```css
--border-thin: 1px;       /* default border, separator, table divider */
--border-regular: 2px;    /* focus ring, active state, emphasized border */
--border-thick: 4px;      /* accent strip, progress fill, tab indicator */
```

### 4.3 Spacing

Dùng default Tailwind scale (`2/3/4/6/8/12` cover 8/12/16/24/32/48px của design.md). Không tự tạo scale mới.

### 4.4 Icon size + stroke

Lucide-react re-export qua wrapper `src/components/ui/icons.tsx`. Wrapper enforced `strokeWidth={2}` mặc định, sizes `16 | 20 | 24` qua prop.

### 4.5 Elevation (boxShadow — tông nâu ấm, opacity thấp)

```css
--shadow-none: none;                                          /* L1 flat */
--shadow-hover: 0 1px 2px rgba(58, 30, 15, 0.05);             /* L2 hover */
--shadow-raised: 0 4px 12px rgba(58, 30, 15, 0.06);           /* L3 raised */
--shadow-modal: 0 24px 48px -12px rgba(58, 30, 15, 0.12);     /* L4 modal */
--shadow-popover: 0 8px 32px rgba(58, 30, 15, 0.10);          /* L5 popover, tooltip, toast */
--shadow-bento: 0 30px 60px -15px rgba(58, 30, 15, 0.10);     /* container bento ngoài cùng */
```
Modal kèm backdrop `bg-black/50 backdrop-blur-sm`.

### 4.6 Color palette (light theme)

| Token | Hex | Mục đích |
|---|---|---|
| `--color-bg-app-from` | `#FAF7F2` | Gradient nền outer (from) |
| `--color-bg-app-to` | `#F4ECE0` | Gradient nền outer (to) — ấm nhẹ, nhấn nhận diện Chill |
| `--color-surface` | `#FFFFFF` | Card chính, modal, input bg-default |
| `--color-surface-muted` | `#F7F4EF` | Card phụ, search pill, table header bg |
| `--color-ink` | `#1A1410` | Text chính + **primary semantic** (CTA dark pill, checkbox-checked, switch-on, tab-active-underline, pagination-current, progress-fill, spinner) |
| `--color-ink-2` | `#5A4A3F` | Text phụ |
| `--color-muted` | `#9C8B7E` | Placeholder, caption mờ, icon inactive |
| `--color-border` | `#EDE6DC` | Viền nhạt mọi nơi |
| `--color-border-strong` | `#2A1E16` | Focus ring (border-regular 2px) |
| `--color-peach` | `#FFD9B8` | KPI #1 bg — nháy brand orange (warm) |
| `--color-peach-ink` | `#8B4513` | Text trên peach |
| `--color-blue` | `#C7D9F5` | KPI #2 bg |
| `--color-blue-ink` | `#1E3A8A` | Text trên blue |
| `--color-mint` | `#C5E8D5` | KPI #3 bg |
| `--color-mint-ink` | `#155E3B` | Text trên mint |
| `--color-lilac` | `#E1D1F0` | KPI #4 bg (dự phòng / promo) |
| `--color-lilac-ink` | `#5B21B6` | Text trên lilac |
| `--color-success` | `#15803D` | Badge solid success |
| `--color-success-soft` | `#D1FAE5` | Badge soft / alert success bg |
| `--color-warning` | `#B45309` | Badge solid warning |
| `--color-warning-soft` | `#FEF3C7` | Badge soft / alert warning bg |
| `--color-danger` | `#B91C1C` | Badge solid danger, destructive button |
| `--color-danger-soft` | `#FEE2E2` | Badge soft / alert danger bg |

**Primary semantic = `--color-ink`** (near-black nâu đậm). Đúng monochrome design.md.
**Brand orange của Chill** thể hiện qua: (a) gradient nền `bg-app-from → bg-app-to` ấm, (b) pastel peach KPI cùng tông. KHÔNG dùng làm "primary."

### 4.7 Typography

```ts
// src/app/fonts.ts
import { Manrope, Bricolage_Grotesque } from "next/font/google";

export const sans = Manrope({
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

export const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
  variable: "--font-display",
  weight: ["600", "700"],
});
```

```css
@theme {
  --font-sans: var(--font-sans, system-ui), sans-serif;
  --font-display: var(--font-display, var(--font-sans)), sans-serif;
}
```

`<html className={`${sans.variable} ${display.variable}`}>` ở `layout.tsx`. Default body class: `font-sans bg-app text-ink antialiased`.

Tabular numbers: utility class `tabular-nums` (Tailwind built-in) áp vào table data cell + KPI big number. Không cần font mono riêng.

### 4.8 Theme-able structure

Light values mặc định trong `@theme`. Khi thêm dark sau:
```css
[data-theme="dark"] {
  --color-bg-app-from: ...;
  --color-surface: ...;
  --color-ink: ...;
  /* etc — chỉ thay value, không sửa component */
}
```
Phase 2 chỉ ship light; structure ready.

---

## 5. Component catalog (~35 component)

Mọi interactive component có 5 state cơ bản: **default / hover / active / disabled / focus-visible** + states đặc thù (loading / empty / error) nơi áp dụng. A11y qua Radix; style qua `cn()` (clsx + tailwind-merge).

### 5.1 Layout (4)
| Component | File | Radix |
|---|---|---|
| AppShell | `src/components/layout/app-shell.tsx` | – |
| Sidebar | `src/components/layout/sidebar.tsx` | – |
| NavItem | `src/components/layout/nav-item.tsx` | – |
| TopBar | `src/components/layout/top-bar.tsx` | – |

- **AppShell**: outer `bg-app gradient` + main bento card (`bg-surface rounded-2xl shadow-bento p-6`) + grid `[sidebar | content]`.
- **Sidebar**: width 240px, slots cho `<Logo/>`, `<SectionHeader/>`, `<NavItem/>` stack.
- **NavItem**: icon (Lucide, 20px) + label; inactive (text-muted, no bg) / hover (`bg-surface-muted`) / active (`bg-ink text-white rounded-full px-4 py-2`).
- **TopBar**: search pill (`bg-surface-muted rounded-full` + Lucide search + ⌘F kbd hint pill) + bell icon-button + Avatar.

### 5.2 Buttons (2)
| Component | File | Radix |
|---|---|---|
| Button | `src/components/ui/button.tsx` | – |
| IconButton | `src/components/ui/icon-button.tsx` | – |

- **Button**: variants `primary` (bg-ink text-white) / `secondary` (border + bg-transparent) / `destructive` (bg-danger text-white) / `ghost` (no bg, hover bg-surface-muted). Sizes `sm` (h-9 px-4) / `md` (h-10 px-5) / `lg` (h-12 px-6). Optional `leadingIcon`, `loading` (spinner thay icon + text disabled). Default radius `rounded-full` (pill); prop `square` → `rounded-md`.
- **IconButton**: size `32 | 40 | 48` (w & h equal); cùng variants Button; tròn `rounded-full` mặc định.

### 5.3 Form (6)
| Component | File | Radix |
|---|---|---|
| TextField | `src/components/ui/text-field.tsx` | – (native input) |
| Checkbox | `src/components/ui/checkbox.tsx` | `react-checkbox` |
| Radio + RadioGroup | `src/components/ui/radio.tsx` | `react-radio-group` |
| Switch | `src/components/ui/switch.tsx` | `react-switch` |
| Slider | `src/components/ui/slider.tsx` | `react-slider` |
| Select | `src/components/ui/select.tsx` | `react-select` |

- **TextField**: stack `<Label/>` (text-xs font-medium) → `<input>` (border-thin rounded-sm px-3 py-2, focus: border-ink border-regular + ring nhẹ) → `<Helper/>` hoặc `<Error/>` (text-xs muted / text-danger). States: default / focus / filled / disabled (bg-surface-muted) / error (border-danger).
- **Checkbox**: 16/20px square `rounded-xs`. Unchecked: border-thin border-muted. Checked: `bg-ink` + Lucide check trắng.
- **Radio**: 16/20px tròn. Unchecked: border-thin. Checked: border-ink border-regular + dot ink center.
- **Switch**: pill 36×20, thumb 16px tròn. Off: `bg-border` thumb left. On: `bg-ink` thumb right. Transition 200ms.
- **Slider**: track 2px `bg-border`, active track ink, thumb 18px white border-ink-2. Value tooltip pill đen text-xs khi drag.
- **Select**: trigger pill (`border-thin rounded-full px-4 py-2 + chevron-down`). Menu content `bg-surface rounded-md shadow-popover` items hover `bg-surface-muted`.

### 5.4 Navigation (4)
| Component | File | Radix |
|---|---|---|
| Tabs | `src/components/ui/tabs.tsx` | `react-tabs` |
| Breadcrumbs | `src/components/ui/breadcrumbs.tsx` | – |
| Stepper | `src/components/ui/stepper.tsx` | – |
| Pagination | `src/components/ui/pagination.tsx` | – |

- **Tabs**: tab list ngang `gap-6`. Inactive: text-muted. Active: text-ink + underline `border-regular bg-ink` 2px dưới.
- **Breadcrumbs**: inline, separator `<ChevronRight size={16}/>`. Level cuối font-medium text-ink, không click. Spacing `gap-2`.
- **Stepper**: ngang. Mỗi step circle 32px + label dưới. Completed: `bg-ink` + check trắng. Current: `bg-ink` + số trắng (text-display). Upcoming: `border-thin border-muted` + số muted. Connector line giữa step: thin, ink cho completed, muted cho upcoming.
- **Pagination**: row `[Prev] [1] [2] [3] [Next]`. Mỗi page number: box vuông `rounded-sm w-9 h-9`. Current: `bg-ink text-white`. Hover non-current: `bg-surface-muted`.

### 5.5 Data display (10)
| Component | File | Radix |
|---|---|---|
| Card | `src/components/ui/card.tsx` | – |
| BentoCard | `src/components/ui/bento-card.tsx` | – |
| StatCard | `src/components/ui/stat-card.tsx` | – |
| PromoCard | `src/components/ui/promo-card.tsx` | – |
| InsightCard | `src/components/ui/insight-card.tsx` | – |
| ListItem | `src/components/ui/list-item.tsx` | – |
| Badge | `src/components/ui/badge.tsx` | – |
| Avatar + AvatarGroup | `src/components/ui/avatar.tsx` | – |
| Tooltip | `src/components/ui/tooltip.tsx` | `react-tooltip` |
| DataTable | `src/components/ui/data-table.tsx` | – (custom, generic over row type) |

- **Card**: base `bg-surface rounded-lg shadow-raised`. Slots optional: `<Card.Header/>`, `<Card.Body/>`, `<Card.Footer/>`. Padding default `p-5`.
- **BentoCard**: Card variant cho bento layout. Props `colSpan` / `rowSpan` (Tailwind class strings). Margin-collapse-safe.
- **StatCard**: color prop `peach | blue | mint | lilac` → bg + ink-on-bg tokens. Layout: title (text-sm font-medium) + subtitle (text-xs muted) trên, big number (text-3xl font-display font-bold tabular-nums) ở dưới, IconButton round (`size=40 variant=primary` icon arrow-up-right) góc dưới phải. Optional decoration blob.
- **PromoCard**: bg dark gradient (`from-ink to-ink/80`). Badge "PRO" pill text-xs ở góc trên trái. Headline 2 dòng text-display text-3xl text-white. IconButton (trắng border-thin) ở góc trên phải. Optional stat strip trên (icon tròn pastel + text-xs trắng).
- **InsightCard**: icon tròn `w-9 h-9 rounded-full` bg-pastel-X + Lucide icon. Title text-sm font-medium + description text-xs muted. Footer link "Xem chi tiết →" text-xs ink với mũi tên.
- **ListItem**: row `<Avatar/> <text block>`. Title `text-sm font-medium`, subtitle `text-xs muted`. Hover `bg-surface-muted`. Separator `border-b border-thin` giữa các item.
- **Badge**: 3 variants:
  - `solid`: `bg-{semantic} text-white rounded-full px-2 py-0.5 text-xs`.
  - `soft`: `bg-{semantic}-soft text-{semantic} rounded-full px-2 py-0.5 text-xs`.
  - `count`: `bg-ink text-white rounded-full min-w-5 h-5 text-xs px-1.5` (notification counter).
  Dot prefix optional.
- **Avatar**: sizes `xs(24) | sm(32) | md(40) | lg(48)`. Image OR initials fallback trên bg-pastel-{deterministic-by-initial}. AvatarGroup: stack với `-ml-2` overlap + ring-2 ring-white.
- **Tooltip**: bg-ink text-white text-xs px-2 py-1 rounded-sm + arrow nhỏ. Delay open 500ms.
- **DataTable**: generic `<DataTable<T> columns={...} data={...} />`. Header row `bg-surface-muted text-xs uppercase font-medium text-muted`. Sort indicator (arrow up/down) cạnh column name. Data row `py-3 px-4` separator mỏng. Status column support Badge column type.

### 5.6 Feedback (7)
| Component | File | Radix |
|---|---|---|
| Modal/Dialog | `src/components/ui/modal.tsx` | `react-dialog` |
| Toast + ToastProvider | `src/components/ui/toast.tsx` | `react-toast` |
| AlertBanner | `src/components/ui/alert-banner.tsx` | – |
| ProgressBar | `src/components/ui/progress-bar.tsx` | `react-progress` |
| Spinner | `src/components/ui/spinner.tsx` | – |
| Skeleton | `src/components/ui/skeleton.tsx` | – |
| EmptyState | `src/components/ui/empty-state.tsx` | – |

- **Modal**: backdrop `bg-black/50 backdrop-blur-sm`. Container `bg-surface rounded-lg shadow-modal max-w-md p-6`. Slots: optional `<Modal.Icon/>` → `<Modal.Title/>` → `<Modal.Body/>` → `<Modal.Actions/>` (Cancel + Confirm/Destructive). Close X icon-button góc trên phải optional.
- **Toast**: vị trí bottom-right. Pill `bg-surface rounded-md shadow-popover px-4 py-3` + icon trạng thái (check/info/warning/x) bên trái. Auto-dismiss 4s. Slide-in từ phải bằng CSS `@keyframes`. Stack vertical `gap-2`. `<ToastProvider/>` mount ở root layout sau này (chuẩn bị API; mount thật ở Phase 3A).
- **AlertBanner**: full-width inline. variants `info / success / warning / danger` → bg soft + text dark + icon trái. Close button phải optional.
- **ProgressBar**: linear, height 6-8px, track `bg-border`, fill `bg-ink rounded-full`. Indeterminate: shimmer keyframe chạy ngang. Label `%` text-xs phải optional.
- **Spinner**: SVG circular `stroke-current stroke-2 fill-none`, sizes `16/24/32`. Rotation `animate-spin` 1s linear infinite. Color inherits (default ink).
- **Skeleton**: bg-surface-muted với shimmer gradient keyframe chạy ngang. Props `width` / `height` / `rounded`. Rounded default `rounded-sm`.
- **EmptyState**: container `border border-dashed border-thin border-muted rounded-lg p-12 text-center`. Icon lớn (40px) muted + title text-base font-medium + subtitle text-sm muted + CTA Button (size sm) optional.

### 5.7 Charts (2)
| Component | File | Wrap |
|---|---|---|
| BarChart | `src/components/charts/bar-chart.tsx` | Recharts |
| LineChart | `src/components/charts/line-chart.tsx` | Recharts |

- **BarChart**: props `data`, `xKey`, `yKey`, `highlightKey?` (bar được nhấn dùng gradient/pattern). Bar `shape` custom render rect bo góc trên (`rounded-t-md`). Tooltip custom render: pill đen `bg-ink text-white rounded-sm px-2 py-1` với value + dot indicator. `cartesianGrid` ẩn (no gridlines). Trục X label ngày, trục Y số tabular.
- **LineChart**: stroke `text-ink stroke-2`. Dots ẩn, chỉ hiện trên hover. Tooltip cùng kiểu pill đen.

### 5.8 Utility (2)
| File | Mục đích |
|---|---|
| `src/lib/cn.ts` | `cn(...inputs: ClassValue[]) => string` — wrap `tailwind-merge(clsx(...inputs))` |
| `src/components/ui/icons.tsx` | Re-export lucide-react icon dùng nhiều + wrapper `<Icon name=... size=16/20/24>` enforced strokeWidth 2 |

**Tổng:** 4 + 2 + 6 + 4 + 10 + 7 + 2 + 2 = **37 đơn vị** code (~35 component + 2 utility).

---

## 6. Playground

Route public `/playground` (no auth required):

- **Layout:** sidebar trái với link tới mỗi category section + content scrollable bên phải. Dùng AppShell + Sidebar + Tabs đã build.
- **Sections theo category:** Layout, Buttons, Form, Navigation, Data Display, Feedback, Charts. Mỗi section heading + grid demo các component samples.
- **Mỗi interactive component:** toggle buttons để chuyển state (hover/disabled/loading/error). Sample data dummy inline.
- **Implementation:** mỗi section là 1 file dưới `src/app/playground/_sections/` (vd `forms-section.tsx`). `playground/page.tsx` ghép chúng lại.
- **Mục đích:**
  1. Đối chiếu mắt mọi component với `design.md`.
  2. Test keyboard navigation (Tab/Shift+Tab/Enter/Esc/Space).
  3. Test responsive ở breakpoint `1180px` / `760px`.
  4. Là sandbox cho dev tương lai khi cần demo/sửa component.

---

## 7. Tiêu chí Phase 2 done

1. **`/playground` render đủ ~35 component** ở mọi state, đối chiếu mắt đạt với `design.md`.
2. **Keyboard navigation hoạt động** mọi interactive (Tab/Shift+Tab/Enter/Esc/Space/Arrow trên menu/tab) — qua Radix.
3. **Focus ring visible** `border-regular border-ink-strong` trên `:focus-visible` mọi interactive.
4. **Touch target ≥44px** mọi button/control khi viewport mobile (<760px).
5. **`npx tsc --noEmit` PASS.**
6. **`npm run build` PASS**, không Tailwind cảnh báo, route `/playground` xuất hiện trong route list.
7. **Theme-able proof:** chèn `<html data-theme="dark">` (không định nghĩa value dark) → app KHÔNG crash, mọi component render fallback (light values vẫn áp dụng vì biến CSS chưa được override). Khi value dark được định nghĩa sau, không phải sửa component code.
8. **`/playground` mở qua Docker stack** (`npm run dev` host hoặc qua container): HTTP 200, không runtime error JS console.
9. **Smoke test Phase 1 vẫn PASS** trên branch này (không hỏng nền tảng).

---

## 8. Out of scope (deferred — KHÔNG làm ở Phase 2)

| Hạng mục | Hoãn sang phase |
|---|---|
| **Dark mode values** (định nghĩa palette tối) | Phase 6 hardening, hoặc sớm hơn nếu user yêu cầu |
| **Motion library** (framer-motion / motion) cho orchestrated entrance | Phase 3A khi build dashboard có bento staggered reveal |
| **Test tự động UI** (Vitest cho component logic, Playwright visual diff, Storybook) | Phase 6 hardening |
| **Component đặc thù nghiệp vụ** (DenominationGrid, ShiftCheckInForm, CashCountTable…) | Phase 3A/3B/3C tương ứng |
| **Combobox với search** (chưa trong design.md) | JIT ở Phase 3 nếu module cụ thể cần |
| **Date Picker / DateRangePicker** (chưa trong design.md scope) | Phase 3B (chốt két) hoặc Phase 5 (analytics range) |
| **i18n / đa ngôn ngữ** | Không trong roadmap (VN-only như v3) |
| **Animation phức tạp** (scroll-trigger, parallax) | Phase 3+ nếu cần |
| **Print stylesheet cho component** | Phase 3A (reports) |
| **Mock data / fixtures cho playground** vượt mức demo | Phase 6 nếu cần Storybook |

---

## 9. Critical files Phase 2 sẽ tạo / sửa

**Sửa:**
- `src/app/globals.css` — thay nội dung 1 dòng hiện tại bằng `@theme { … }` đầy đủ token (Sec 4).
- `src/app/layout.tsx` — wrap `<html>` với font CSS variables, đặt default body class.
- `package.json` — thêm 17 dependency (Sec 3).

**Tạo:**
- `src/app/fonts.ts` — next/font setup Manrope + Bricolage Grotesque.
- `src/lib/cn.ts` — utility.
- `src/components/ui/*.tsx` — ~25 file primitive (Sec 5.2–5.6 + utility icons).
- `src/components/layout/*.tsx` — 4 file (Sec 5.1).
- `src/components/charts/*.tsx` — 2 file (Sec 5.7).
- `src/app/playground/page.tsx` — root playground.
- `src/app/playground/_sections/*.tsx` — 7 section file (Sec 6).

Branch: **`phase-2-design-system`** (đã tách từ `main` ở `60585c8`). Khi Phase 2 done → merge vào `main` + tag `v4-phase-2`.

---

## 10. Phụ thuộc & rủi ro

- **Manrope + Bricolage Grotesque** sẽ tải qua `next/font/google` lúc build. Yêu cầu internet khi build (Next.js cache fonts vào `.next/cache/fonts`). Không ảnh hưởng runtime.
- **Radix v.x** thỉnh thoảng có breaking change minor; pin tight nếu cần ổn định tuyệt đối — Phase 2 dùng `^1.x`/`^2.x` để hưởng patch.
- **Recharts** có known issue với React 19 server-component; tất cả chart wrapper dán `"use client"` để né.
- **Tailwind v4 + Next.js 15:** `@theme` block + `@tailwindcss/postcss` đã chạy được ở Phase 1 (placeholder page render đúng class). Mở rộng chỉ là thêm token, không thay đổi build pipeline.

---

**Tài liệu này được duyệt qua brainstorm 2026-05-20 (4 câu hỏi đã trả lời). Phase 2 implementation plan sẽ dựng từ spec này bằng skill `superpowers:writing-plans`.**
