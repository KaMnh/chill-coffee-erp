# Phase 2: Design System & Component Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng Tailwind v4 design tokens đầy đủ + thư viện ~35 component theo `design.md`, mỗi cái đủ states, render được trong `/playground`. Vẫn KHÔNG có UI nghiệp vụ.

**Architecture:** Radix UI primitives raw, wrap mỏng với Tailwind classes qua `cn()` utility. Design tokens trong `@theme` của `globals.css` (Tailwind v4 CSS-first). Recharts cho `BarChart`/`LineChart`. Manrope + Bricolage Grotesque qua `next/font/google`. Mọi component dùng token semantic, không hardcode hex.

**Tech Stack:** Next.js 15 · React 19 · Tailwind CSS v4 · Radix UI · Recharts · clsx + tailwind-merge · next/font/google · lucide-react

**Spec nguồn:** `docs/superpowers/specs/2026-05-20-phase-2-design-system-design.md` (đọc trước khi bắt đầu).

**Branch:** `phase-2-design-system` (đã tách từ `main` tại `60585c8`, tag `v4-phase-1`).

**Quy ước thực thi:**
- Mọi lệnh shell chạy trong **Windows PowerShell**, cwd = `C:\Users\RAZER 15\Documents\Claude\Projects\Chill Coffee ERP`.
- Mỗi commit cuối task kèm trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Sau mỗi task: `npx tsc --noEmit` PASS là tối thiểu. `npm run build` PASS ở task có route mới.
- Không touch ice-factory containers, không touch Phase 1 backend code (`src/lib`, `src/hooks`, `src/middleware.ts`, `src/app/api`, `database`).

---

## File Structure (sau Phase 2)

```
Chill Coffee ERP/
├── package.json                              ✎ thêm 17 dep (Radix + recharts + clsx + tailwind-merge)
├── src/
│   ├── app/
│   │   ├── fonts.ts                          ✎ next/font Manrope + Bricolage Grotesque
│   │   ├── globals.css                       ✎ thay 1 dòng @import bằng @theme tokens đầy đủ
│   │   ├── layout.tsx                        ✎ wrap html với font CSS vars
│   │   └── playground/
│   │       ├── page.tsx                      ✎ ghép sections
│   │       └── _sections/
│   │           ├── layout-section.tsx        ✎
│   │           ├── buttons-section.tsx       ✎
│   │           ├── form-section.tsx          ✎
│   │           ├── navigation-section.tsx    ✎
│   │           ├── data-display-section.tsx  ✎
│   │           ├── feedback-section.tsx      ✎
│   │           └── charts-section.tsx        ✎
│   ├── lib/
│   │   └── cn.ts                             ✎ clsx + tailwind-merge utility
│   └── components/
│       ├── layout/
│       │   ├── app-shell.tsx                 ✎
│       │   ├── sidebar.tsx                   ✎
│       │   ├── nav-item.tsx                  ✎
│       │   └── top-bar.tsx                   ✎
│       ├── ui/
│       │   ├── icons.tsx                     ✎ Lucide wrapper
│       │   ├── button.tsx                    ✎
│       │   ├── icon-button.tsx               ✎
│       │   ├── text-field.tsx                ✎
│       │   ├── checkbox.tsx                  ✎
│       │   ├── radio.tsx                     ✎
│       │   ├── switch.tsx                    ✎
│       │   ├── slider.tsx                    ✎
│       │   ├── select.tsx                    ✎
│       │   ├── tabs.tsx                      ✎
│       │   ├── breadcrumbs.tsx               ✎
│       │   ├── stepper.tsx                   ✎
│       │   ├── pagination.tsx                ✎
│       │   ├── card.tsx                      ✎
│       │   ├── bento-card.tsx                ✎
│       │   ├── stat-card.tsx                 ✎
│       │   ├── promo-card.tsx                ✎
│       │   ├── insight-card.tsx              ✎
│       │   ├── list-item.tsx                 ✎
│       │   ├── badge.tsx                     ✎
│       │   ├── avatar.tsx                    ✎ Avatar + AvatarGroup
│       │   ├── tooltip.tsx                   ✎
│       │   ├── data-table.tsx                ✎
│       │   ├── modal.tsx                     ✎
│       │   ├── toast.tsx                     ✎ Toast + ToastProvider + useToast
│       │   ├── alert-banner.tsx              ✎
│       │   ├── progress-bar.tsx              ✎
│       │   ├── spinner.tsx                   ✎
│       │   ├── skeleton.tsx                  ✎
│       │   └── empty-state.tsx               ✎
│       └── charts/
│           ├── bar-chart.tsx                 ✎
│           └── line-chart.tsx                ✎
```

Tổng: ~40 file mới, 3 file sửa (`package.json`, `globals.css`, `layout.tsx`).

---

## Quy ước chung trong code

**Mọi file component (`use client` cần thiết khi dùng Radix/hooks):**
```tsx
"use client";
import { ... } from "react";
import { cn } from "@/lib/cn";
```

**Forward refs** cho mọi component có thể nhận `ref` (Button, TextField, Modal trigger, …) — chuẩn React + tương thích Radix.

**Token classes** dùng tên đã định nghĩa trong `@theme`:
- `bg-surface`, `bg-surface-muted`, `bg-ink`, `bg-peach`, `bg-blue`, `bg-mint`, `bg-lilac`, `bg-success`, `bg-success-soft`, `bg-warning`, `bg-warning-soft`, `bg-danger`, `bg-danger-soft`
- `text-ink`, `text-ink-2`, `text-muted`, `text-peach-ink`, `text-blue-ink`, `text-mint-ink`, `text-lilac-ink`, `text-success`, `text-warning`, `text-danger`
- `border-border`, `border-border-strong` (border color); `border`/`border-2`/`border-4` (width via Tailwind defaults)
- `rounded-xs/sm/md/lg/xl/2xl/full`
- `shadow-hover/raised/modal/popover/bento` (custom shadows)
- `font-sans`, `font-display`

**Focus ring tiêu chuẩn:**
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2`

**`cn()`** dùng cho mọi conditional/merge class.

---

## Task 1: Foundation — dependencies, fonts, tokens, utilities

**Files:**
- Modify: `package.json`
- Create: `src/app/fonts.ts`, `src/lib/cn.ts`, `src/components/ui/icons.tsx`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`

- [ ] **Step 1: Cài dependencies mới**

Run:
```powershell
npm install --save @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-popover @radix-ui/react-progress @radix-ui/react-radio-group @radix-ui/react-scroll-area @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slider @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-toast @radix-ui/react-tooltip clsx recharts tailwind-merge
```
Expected: `package.json` `dependencies` có thêm 17 entry, `package-lock.json` cập nhật, không lỗi (cảnh báo peer OK).

- [ ] **Step 2: Tạo `src/app/fonts.ts`**

```ts
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

- [ ] **Step 3: Thay nội dung `src/app/globals.css`** (thay TOÀN BỘ 1 dòng `@import "tailwindcss";` hiện tại bằng nội dung dưới)

```css
@import "tailwindcss";

@theme {
  /* ===== Fonts =====
   * `--font-sans` self-reference: next/font injects a CSS variable named
   * `--font-sans` on <html> (via className on layout.tsx). That injected value
   * cascades and overrides the @theme fallback chain at runtime. Same for
   * --font-display. Do NOT "simplify" away the var() call — both refs are
   * needed: Tailwind's @theme value as the family-chain default, next/font's
   * injection as the actual loaded family.
   */
  --font-sans: var(--font-sans, system-ui), sans-serif;
  --font-display: var(--font-display, var(--font-sans)), sans-serif;

  /* ===== Radius ===== */
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-2xl: 32px;
  --radius-full: 9999px;

  /* ===== Shadows (tông nâu ấm, opacity thấp) ===== */
  --shadow-none: none;
  --shadow-hover: 0 1px 2px rgba(58, 30, 15, 0.05);
  --shadow-raised: 0 4px 12px rgba(58, 30, 15, 0.06);
  --shadow-modal: 0 24px 48px -12px rgba(58, 30, 15, 0.12);
  --shadow-popover: 0 8px 32px rgba(58, 30, 15, 0.10);
  --shadow-bento: 0 30px 60px -15px rgba(58, 30, 15, 0.10);

  /* ===== Colors — light theme ===== */
  --color-bg-app-from: #FAF7F2;
  --color-bg-app-to: #F4ECE0;
  --color-surface: #FFFFFF;
  --color-surface-muted: #F7F4EF;
  --color-ink: #1A1410;
  --color-ink-2: #5A4A3F;
  --color-muted: #6B5C52;          /* darkened from #9C8B7E để pass WCAG AA (~4.5:1 trên trắng) */
  --color-border: #EDE6DC;
  --color-border-strong: #2A1E16;

  /* Pastel KPI palette */
  --color-peach: #FFD9B8;
  --color-peach-ink: #8B4513;
  --color-blue: #C7D9F5;
  --color-blue-ink: #1E3A8A;
  --color-mint: #C5E8D5;
  --color-mint-ink: #155E3B;
  --color-lilac: #E1D1F0;
  --color-lilac-ink: #5B21B6;

  /* Semantic */
  --color-success: #146A34;        /* darkened from #15803D để đạt 4.5:1 trên --color-success-soft */
  --color-success-soft: #D1FAE5;
  --color-warning: #B45309;
  --color-warning-soft: #FEF3C7;
  --color-danger: #B91C1C;
  --color-danger-soft: #FEE2E2;
}

/* Background gradient cho toàn app — apply trên body.
 * font-family áp qua Tailwind class `font-sans` trên <body> ở layout.tsx,
 * không cần khai báo lại ở đây.
 */
body {
  background: linear-gradient(135deg, var(--color-bg-app-from) 0%, var(--color-bg-app-to) 100%);
  background-attachment: fixed;
  min-height: 100vh;
  color: var(--color-ink);
}

/* Shimmer animation cho Skeleton + ProgressBar indeterminate */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.5) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}

/* Toast slide-in animation */
@keyframes toast-slide-in {
  from { transform: translateX(calc(100% + 1rem)); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.toast-enter {
  animation: toast-slide-in 200ms ease-out;
}
```

- [ ] **Step 4: Sửa `src/app/layout.tsx`** — apply font variables vào `<html>`

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { sans, display } from "./fonts";

export const metadata: Metadata = {
  title: "Chill Coffee ERP",
  description: "Hệ thống quản lý vận hành Chill Coffee Garden",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body suppressHydrationWarning className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Tạo `src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Tạo `src/components/ui/icons.tsx`** — wrapper enforced strokeWidth + size

```tsx
"use client";

import {
  ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, ChevronLeft,
  ChevronRight, Filter, Info, Loader2, Search, X, Plus, Minus,
  AlertTriangle, AlertCircle, CheckCircle2, Sparkles,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { forwardRef } from "react";

export const Icons = {
  arrowRight: ArrowRight,
  arrowUpRight: ArrowUpRight,
  bell: Bell,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  filter: Filter,
  info: Info,
  loader: Loader2,
  search: Search,
  x: X,
  plus: Plus,
  minus: Minus,
  alertTriangle: AlertTriangle,
  alertCircle: AlertCircle,
  checkCircle: CheckCircle2,
  sparkles: Sparkles,
} as const;

export type IconName = keyof typeof Icons;
type IconSize = 16 | 20 | 24;

export interface IconProps extends Omit<LucideProps, "size" | "strokeWidth"> {
  name: IconName;
  size?: IconSize;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 20, ...rest },
  ref
) {
  const Component: LucideIcon = Icons[name];
  return <Component ref={ref} size={size} strokeWidth={2} {...rest} />;
});
```

- [ ] **Step 7: Verify tsc + build**

```powershell
npx tsc --noEmit
npm run build
```
Expected: cả hai PASS. Build vẫn liệt kê route `/` (placeholder Phase 1 chưa đổi).

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json src/app/fonts.ts src/app/globals.css src/app/layout.tsx src/lib/cn.ts src/components/ui/icons.tsx
git commit -m "feat(phase-2): foundation — deps, fonts, tokens, cn(), Icon wrapper"
```

---

## Task 2: Layout primitives — AppShell, Sidebar, NavItem, TopBar

**Files:**
- Create: `src/components/layout/{app-shell,sidebar,nav-item,top-bar}.tsx`

- [ ] **Step 1: Tạo `src/components/layout/app-shell.tsx`**

```tsx
import { cn } from "@/lib/cn";

interface AppShellProps {
  sidebar: React.ReactNode;
  topBar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function AppShell({ sidebar, topBar, children, className }: AppShellProps) {
  return (
    <div className={cn("min-h-screen p-4 md:p-6", className)}>
      {/* Main bento card chứa toàn bộ UI */}
      <div className="mx-auto max-w-[1500px] rounded-2xl bg-surface shadow-bento overflow-hidden">
        <div className="grid grid-cols-[240px_1fr] min-h-[calc(100vh-3rem)]">
          {/* Sidebar */}
          <aside className="border-r border-border">{sidebar}</aside>
          {/* Right column: topbar + content */}
          <div className="flex flex-col">
            <div className="border-b border-border">{topBar}</div>
            <main className="flex-1 p-6 overflow-auto">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Tạo `src/components/layout/sidebar.tsx`**

```tsx
import { cn } from "@/lib/cn";

interface SidebarProps {
  children: React.ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  return (
    <nav className={cn("flex flex-col gap-1 p-4", className)}>{children}</nav>
  );
}

export function SidebarSection({
  label,
  children,
}: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 mt-4 first:mt-0">
      {label && (
        <div className="px-3 py-1 text-xs uppercase tracking-wider text-muted">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

export function SidebarLogo({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 font-display text-xl font-bold">{children}</div>;
}
```

- [ ] **Step 3: Tạo `src/components/layout/nav-item.tsx`**

```tsx
"use client";

import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icons";

interface NavItemProps {
  icon?: IconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  className?: string;
}

const baseClass =
  "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2";

const activeClass = "rounded-full bg-ink text-white";
const inactiveClass = "rounded-md text-ink-2 hover:bg-surface-muted hover:text-ink";

export function NavItem({ icon, label, active, onClick, href, className }: NavItemProps) {
  const content = (
    <>
      {icon && <Icon name={icon} size={20} />}
      <span>{label}</span>
    </>
  );

  // Split element returns thay vì dynamic Component — TypeScript narrow đúng theo element,
  // aria attribute đúng per-branch (page vs pressed).
  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn(baseClass, active ? activeClass : inactiveClass, className)}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(baseClass, active ? activeClass : inactiveClass, className)}
    >
      {content}
    </button>
  );
}
```

- [ ] **Step 4: Tạo `src/components/layout/top-bar.tsx`**

```tsx
"use client";

import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";

interface TopBarProps {
  search?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function TopBar({ search, actions, className }: TopBarProps) {
  return (
    <div className={cn("flex items-center gap-4 px-6 py-4", className)}>
      <div className="flex-1">{search ?? <SearchBar />}</div>
      <div className="flex items-center gap-3">{actions}</div>
    </div>
  );
}

export function SearchBar({
  placeholder = "Tìm kiếm…",
  shortcut = "⌘F",
}: { placeholder?: string; shortcut?: string }) {
  return (
    <div className="relative flex items-center max-w-md">
      <Icon name="search" size={20} className="absolute left-4 text-muted" />
      <input
        type="search"
        placeholder={placeholder}
        aria-label="Tìm kiếm"
        className="w-full h-10 pl-11 pr-16 rounded-full bg-surface-muted border border-transparent text-sm placeholder:text-muted focus-visible:outline-none focus-visible:border-border-strong focus-visible:border-2"
      />
      <kbd className="absolute right-3 px-1.5 py-0.5 text-xs text-muted bg-surface rounded-xs border border-border">
        {shortcut}
      </kbd>
    </div>
  );
}
```

- [ ] **Step 5: Verify + commit**

```powershell
npx tsc --noEmit
```
Expected: PASS.

```powershell
git add src/components/layout
git commit -m "feat(phase-2): layout primitives — AppShell, Sidebar, NavItem, TopBar"
```

---

## Task 3: Buttons — Button + IconButton

**Files:**
- Create: `src/components/ui/{button,icon-button}.tsx`

- [ ] **Step 1: Tạo `src/components/ui/button.tsx`**

```tsx
"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  square?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2 active:bg-ink/90",
  secondary: "border border-border text-ink hover:bg-surface-muted",
  destructive: "bg-danger text-white hover:bg-danger/90",
  ghost: "text-ink hover:bg-surface-muted",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, leadingIcon, trailingIcon, square, className, children, disabled, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        square ? "rounded-md" : "rounded-full",
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {loading ? <Icon name="loader" size={16} className="animate-spin" /> : leadingIcon}
      {children && <span>{children}</span>}
      {trailingIcon}
    </button>
  );
});
```

- [ ] **Step 2: Tạo `src/components/ui/icon-button.tsx`**

```tsx
"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";
import type { ButtonVariant } from "./button";

export type IconButtonSize = 32 | 40 | 48;

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  size?: IconButtonSize;
  variant?: ButtonVariant;
  "aria-label": string; // bắt buộc cho a11y
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2 active:bg-ink/90",
  secondary: "border border-border text-ink hover:bg-surface-muted active:bg-surface-muted/80",
  destructive: "bg-danger text-white hover:bg-danger/90 active:bg-danger/80",
  ghost: "text-ink hover:bg-surface-muted active:bg-surface-muted/80",
};

const iconSize: Record<IconButtonSize, 16 | 20 | 24> = {
  32: 16,
  40: 20,
  48: 24,
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 40, variant = "primary", className, disabled, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex items-center justify-center rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        variantClass[variant],
        className
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize[size]} />
    </button>
  );
});
```

- [ ] **Step 3: Verify + commit**

```powershell
npx tsc --noEmit
git add src/components/ui/button.tsx src/components/ui/icon-button.tsx
git commit -m "feat(phase-2): Button + IconButton"
```

---

## Task 4: Form controls — TextField, Checkbox, Radio, Switch, Slider, Select

**Files:**
- Create: `src/components/ui/{text-field,checkbox,radio,switch,slider,select}.tsx`

- [ ] **Step 1: Tạo `src/components/ui/text-field.tsx`**

```tsx
"use client";

import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, helper, error, id, className, disabled, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helperId = `${inputId}-helper`;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-ink-2">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={(helper || error) ? helperId : undefined}
        className={cn(
          "h-10 px-3 rounded-sm bg-surface border text-sm text-ink placeholder:text-muted transition-colors",
          "focus-visible:outline-none focus-visible:border-2",
          error
            ? "border-danger focus-visible:border-danger"
            : "border-border focus-visible:border-border-strong",
          disabled && "bg-surface-muted text-muted cursor-not-allowed",
          className
        )}
        {...rest}
      />
      {(helper || error) && (
        <span
          id={helperId}
          className={cn("text-xs", error ? "text-danger" : "text-muted")}
        >
          {error ?? helper}
        </span>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Tạo `src/components/ui/checkbox.tsx`**

```tsx
"use client";

import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface CheckboxProps extends React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root> {
  label?: React.ReactNode;
}

export const Checkbox = forwardRef<
  React.ElementRef<typeof RadixCheckbox.Root>,
  CheckboxProps
>(function Checkbox({ label, id, className, ...rest }, ref) {
  const autoId = useId();
  const checkboxId = id ?? autoId;
  return (
    <div className="inline-flex items-center gap-2">
      <RadixCheckbox.Root
        ref={ref}
        id={checkboxId}
        className={cn(
          "w-5 h-5 rounded-xs border border-border bg-surface flex items-center justify-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
          "data-[state=checked]:bg-ink data-[state=checked]:border-ink",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          className
        )}
        {...rest}
      >
        <RadixCheckbox.Indicator>
          <Icon name="check" size={16} className="text-white" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label && (
        <label htmlFor={checkboxId} className="text-sm text-ink select-none cursor-pointer">
          {label}
        </label>
      )}
    </div>
  );
});
```

- [ ] **Step 3: Tạo `src/components/ui/radio.tsx`**

```tsx
"use client";

import * as RadixRadio from "@radix-ui/react-radio-group";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

export const RadioGroup = forwardRef<
  React.ElementRef<typeof RadixRadio.Root>,
  React.ComponentPropsWithoutRef<typeof RadixRadio.Root>
>(function RadioGroup({ className, ...rest }, ref) {
  return (
    <RadixRadio.Root ref={ref} className={cn("flex flex-col gap-3", className)} {...rest} />
  );
});

export interface RadioProps extends React.ComponentPropsWithoutRef<typeof RadixRadio.Item> {
  label?: React.ReactNode;
}

export const Radio = forwardRef<React.ElementRef<typeof RadixRadio.Item>, RadioProps>(
  function Radio({ label, id, className, ...rest }, ref) {
    const autoId = useId();
    const radioId = id ?? autoId;
    return (
      <div className="inline-flex items-center gap-2">
        <RadixRadio.Item
          ref={ref}
          id={radioId}
          className={cn(
            "w-5 h-5 rounded-full border border-border bg-surface flex items-center justify-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
            "data-[state=checked]:border-ink data-[state=checked]:border-2",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            className
          )}
          {...rest}
        >
          <RadixRadio.Indicator className="w-2.5 h-2.5 rounded-full bg-ink" />
        </RadixRadio.Item>
        {label && (
          <label htmlFor={radioId} className="text-sm text-ink select-none cursor-pointer">
            {label}
          </label>
        )}
      </div>
    );
  }
);
```

- [ ] **Step 4: Tạo `src/components/ui/switch.tsx`**

```tsx
"use client";

import * as RadixSwitch from "@radix-ui/react-switch";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof RadixSwitch.Root> {
  label?: React.ReactNode;
}

export const Switch = forwardRef<
  React.ElementRef<typeof RadixSwitch.Root>,
  SwitchProps
>(function Switch({ label, id, className, ...rest }, ref) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const root = (
    <RadixSwitch.Root
      ref={ref}
      id={switchId}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full bg-border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "data-[state=checked]:bg-ink",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
      {...rest}
    >
      <RadixSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform duration-200 data-[state=checked]:translate-x-[1.375rem]" />
    </RadixSwitch.Root>
  );
  if (!label) return root;
  return (
    <div className="inline-flex items-center gap-2">
      {root}
      <label htmlFor={switchId} className="text-sm text-ink select-none cursor-pointer">
        {label}
      </label>
    </div>
  );
});
```

- [ ] **Step 5: Tạo `src/components/ui/slider.tsx`**

```tsx
"use client";

import * as RadixSlider from "@radix-ui/react-slider";
import { forwardRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof RadixSlider.Root> {
  formatValue?: (value: number) => string;
}

export const Slider = forwardRef<
  React.ElementRef<typeof RadixSlider.Root>,
  SliderProps
>(function Slider({ formatValue, className, value, defaultValue, onValueChange, ...rest }, ref) {
  const [internal, setInternal] = useState<number[]>(
    (value as number[] | undefined) ?? (defaultValue as number[] | undefined) ?? [0]
  );
  const current = (value as number[] | undefined) ?? internal;
  return (
    <RadixSlider.Root
      ref={ref}
      className={cn("relative flex items-center w-full h-6 select-none touch-none", className)}
      value={current}
      onValueChange={(v) => {
        setInternal(v);
        onValueChange?.(v);
      }}
      {...rest}
    >
      <RadixSlider.Track className="relative flex-1 h-0.5 rounded-full bg-border">
        <RadixSlider.Range className="absolute h-full rounded-full bg-ink" />
      </RadixSlider.Track>
      {current.map((_, i) => (
        <RadixSlider.Thumb
          key={i}
          className={cn(
            "group relative block h-[18px] w-[18px] rounded-full bg-white border-2 border-ink shadow-hover transition-shadow",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
            "hover:shadow-raised"
          )}
        >
          {/* Tooltip pill — visible on hover, drag (:active), keyboard focus. Radix Slider Thumb không có data-dragging,
             dùng :active để bắt drag (mousedown/touchstart giữ class trong toàn quá trình drag). */}
          <span className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-sm bg-ink text-white text-xs px-2 py-1 whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100 group-focus-visible:opacity-100">
            {formatValue ? formatValue(current[i]) : current[i]}
          </span>
        </RadixSlider.Thumb>
      ))}
    </RadixSlider.Root>
  );
});
```

- [ ] **Step 6: Tạo `src/components/ui/select.tsx`**

```tsx
"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export const Select = RadixSelect.Root;
export const SelectValue = RadixSelect.Value;

export interface SelectTriggerProps extends React.ComponentPropsWithoutRef<typeof RadixSelect.Trigger> {}

export const SelectTrigger = forwardRef<
  React.ElementRef<typeof RadixSelect.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ className, children, ...rest }, ref) {
  return (
    <RadixSelect.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-between gap-2 h-10 px-4 rounded-full border border-border bg-surface text-sm text-ink",
        "focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong",
        "data-[placeholder]:text-muted",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
      {...rest}
    >
      {children}
      <RadixSelect.Icon>
        <Icon name="chevronDown" size={16} />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
});

export interface SelectContentProps extends React.ComponentPropsWithoutRef<typeof RadixSelect.Content> {}

export const SelectContent = forwardRef<
  React.ElementRef<typeof RadixSelect.Content>,
  SelectContentProps
>(function SelectContent({ className, children, position = "popper", ...rest }, ref) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        ref={ref}
        position={position}
        sideOffset={4}
        className={cn(
          "min-w-[8rem] overflow-hidden rounded-md border border-border bg-surface shadow-popover z-50",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          className
        )}
        {...rest}
      >
        <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
});

export const SelectItem = forwardRef<
  React.ElementRef<typeof RadixSelect.Item>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Item>
>(function SelectItem({ className, children, ...rest }, ref) {
  return (
    <RadixSelect.Item
      ref={ref}
      className={cn(
        "relative flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-ink cursor-pointer outline-none select-none",
        "data-[highlighted]:bg-surface-muted data-[state=checked]:font-medium",
        "data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed",
        className
      )}
      {...rest}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="ml-auto">
        <Icon name="check" size={16} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
});
```

- [ ] **Step 7: Verify + commit**

```powershell
npx tsc --noEmit
git add src/components/ui/text-field.tsx src/components/ui/checkbox.tsx src/components/ui/radio.tsx src/components/ui/switch.tsx src/components/ui/slider.tsx src/components/ui/select.tsx
git commit -m "feat(phase-2): form controls — TextField, Checkbox, Radio, Switch, Slider, Select"
```

---

## Task 5: Navigation — Tabs, Breadcrumbs, Stepper, Pagination

**Files:**
- Create: `src/components/ui/{tabs,breadcrumbs,stepper,pagination}.tsx`

- [ ] **Step 1: Tạo `src/components/ui/tabs.tsx`**

```tsx
"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(function TabsList({ className, ...rest }, ref) {
  return (
    <RadixTabs.List
      ref={ref}
      className={cn("inline-flex items-center gap-6 border-b border-border", className)}
      {...rest}
    />
  );
});

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(function TabsTrigger({ className, ...rest }, ref) {
  return (
    <RadixTabs.Trigger
      ref={ref}
      className={cn(
        "relative py-3 text-sm font-medium text-muted transition-colors -mb-px",
        "focus-visible:outline-none focus-visible:text-ink",
        "hover:text-ink-2",
        "data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-ink",
        className
      )}
      {...rest}
    />
  );
});

export const TabsContent = forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(function TabsContent({ className, ...rest }, ref) {
  return (
    <RadixTabs.Content
      ref={ref}
      className={cn("pt-4 focus-visible:outline-none", className)}
      {...rest}
    />
  );
});
```

- [ ] **Step 2: Tạo `src/components/ui/breadcrumbs.tsx`**

```tsx
import { Icon } from "./icons";
import { cn } from "@/lib/cn";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav className={cn("inline-flex items-center gap-2 text-sm", className)} aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-2">
            {isLast ? (
              <span className="font-medium text-ink" aria-current="page">{item.label}</span>
            ) : (
              <a href={item.href} className="text-muted hover:text-ink transition-colors">
                {item.label}
              </a>
            )}
            {!isLast && <Icon name="chevronRight" size={16} className="text-muted" />}
          </span>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Tạo `src/components/ui/stepper.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface Step {
  label: string;
}

interface StepperProps {
  steps: Step[];
  current: number; // 0-indexed
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn("flex items-start justify-between gap-2", className)}>
      {steps.map((step, i) => {
        const isCompleted = i < current;
        const isCurrent = i === current;
        const isLast = i === steps.length - 1;
        return (
          <li
            key={i}
            aria-current={isCurrent ? "step" : undefined}
            className="flex-1 flex flex-col items-center"
          >
            <div className="flex items-center w-full">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium font-display",
                  isCompleted || isCurrent
                    ? "bg-ink text-white"
                    : "border border-border text-muted"
                )}
              >
                {isCompleted ? <Icon name="check" size={16} /> : i + 1}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2",
                    isCompleted ? "bg-ink" : "bg-border"
                  )}
                />
              )}
            </div>
            <div
              className={cn(
                "mt-2 text-xs text-center",
                isCurrent ? "text-ink font-medium" : "text-muted"
              )}
            >
              {step.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Tạo `src/components/ui/pagination.tsx`**

```tsx
"use client";

import { cn } from "@/lib/cn";
import { Icon } from "./icons";

interface PaginationProps {
  total: number;
  current: number; // 1-indexed
  onChange: (page: number) => void;
  className?: string;
}

export function Pagination({ total, current, onChange, className }: PaginationProps) {
  const pages = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <nav className={cn("inline-flex items-center gap-1", className)} aria-label="Pagination">
      <PageButton
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
        aria-label="Trang trước"
      >
        <Icon name="chevronLeft" size={16} />
      </PageButton>
      {pages.map((p) => (
        <PageButton
          key={p}
          active={p === current}
          aria-current={p === current ? "page" : undefined}
          onClick={() => onChange(p)}
        >
          {p}
        </PageButton>
      ))}
      <PageButton
        disabled={current === total}
        onClick={() => onChange(current + 1)}
        aria-label="Trang sau"
      >
        <Icon name="chevronRight" size={16} />
      </PageButton>
    </nav>
  );
}

function PageButton({
  active,
  disabled,
  children,
  ...rest
}: {
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "min-w-9 h-9 px-2 inline-flex items-center justify-center rounded-sm text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        active
          ? "bg-ink text-white"
          : "text-ink hover:bg-surface-muted"
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 5: Verify + commit**

```powershell
npx tsc --noEmit
git add src/components/ui/tabs.tsx src/components/ui/breadcrumbs.tsx src/components/ui/stepper.tsx src/components/ui/pagination.tsx
git commit -m "feat(phase-2): navigation — Tabs, Breadcrumbs, Stepper, Pagination"
```

---

## Task 6: Data display A — Card, BentoCard, StatCard, PromoCard, InsightCard

**Files:**
- Create: `src/components/ui/{card,bento-card,stat-card,promo-card,insight-card}.tsx`

- [ ] **Step 1: Tạo `src/components/ui/card.tsx`**

```tsx
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn("bg-surface rounded-lg shadow-raised p-5", className)}
        {...rest}
      />
    );
  }
);

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...rest }, ref) {
    return <div ref={ref} className={cn("flex items-start justify-between gap-4 mb-4", className)} {...rest} />;
  }
);

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...rest }, ref) {
    return <h3 ref={ref} className={cn("text-lg font-semibold text-ink", className)} {...rest} />;
  }
);

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardBody({ className, ...rest }, ref) {
    return <div ref={ref} className={cn("", className)} {...rest} />;
  }
);

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...rest }, ref) {
    return <div ref={ref} className={cn("mt-4 flex items-center justify-end gap-2", className)} {...rest} />;
  }
);
```

- [ ] **Step 2: Tạo `src/components/ui/bento-card.tsx`**

```tsx
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface BentoCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Tailwind col-span class, vd "col-span-2" */
  colSpan?: string;
  /** Tailwind row-span class */
  rowSpan?: string;
}

export const BentoCard = forwardRef<HTMLDivElement, BentoCardProps>(
  function BentoCard({ colSpan, rowSpan, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn("bg-surface rounded-2xl shadow-raised p-6 overflow-hidden", colSpan, rowSpan, className)}
        {...rest}
      />
    );
  }
);
```

- [ ] **Step 3: Tạo `src/components/ui/stat-card.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

export type PastelColor = "peach" | "blue" | "mint" | "lilac";

interface StatCardProps {
  color: PastelColor;
  title: string;
  subtitle?: string;
  value: string | number;
  onAction?: () => void;
  actionAriaLabel?: string;
  className?: string;
}

const colorBg: Record<PastelColor, string> = {
  peach: "bg-peach",
  blue: "bg-blue",
  mint: "bg-mint",
  lilac: "bg-lilac",
};

const colorInk: Record<PastelColor, string> = {
  peach: "text-peach-ink",
  blue: "text-blue-ink",
  mint: "text-mint-ink",
  lilac: "text-lilac-ink",
};

export function StatCard({
  color,
  title,
  subtitle,
  value,
  onAction,
  actionAriaLabel = "Xem chi tiết",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl p-6 min-h-[180px] flex flex-col justify-between overflow-hidden",
        colorBg[color],
        className
      )}
    >
      <div>
        <div className={cn("text-sm font-medium", colorInk[color])}>{title}</div>
        {subtitle && <div className={cn("text-xs mt-1 opacity-80", colorInk[color])}>{subtitle}</div>}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className={cn("font-display text-4xl font-bold tabular-nums", colorInk[color])}>{value}</div>
        {onAction && (
          <IconButton
            icon="arrowUpRight"
            size={40}
            variant="primary"
            onClick={onAction}
            aria-label={actionAriaLabel}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Tạo `src/components/ui/promo-card.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";
import { Icon } from "./icons";

interface PromoCardProps {
  badge?: string;
  badgeIcon?: "sparkles";
  headline: string;
  description?: string;
  onAction?: () => void;
  actionAriaLabel?: string;
  className?: string;
}

export function PromoCard({
  badge = "PRO",
  badgeIcon = "sparkles",
  headline,
  description,
  onAction,
  actionAriaLabel = "Tìm hiểu thêm",
  className,
}: PromoCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl bg-gradient-to-br from-ink to-ink-2 text-white p-6 min-h-[180px] overflow-hidden",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
          <Icon name={badgeIcon} size={16} />
          {badge}
        </div>
        {onAction && (
          <IconButton
            icon="arrowUpRight"
            size={40}
            variant="ghost"
            className="bg-transparent border border-white/30 text-white hover:bg-white/10"
            onClick={onAction}
            aria-label={actionAriaLabel}
          />
        )}
      </div>
      <div className="mt-6">
        <div className="font-display text-2xl font-bold leading-tight">{headline}</div>
        {description && <div className="mt-2 text-sm text-white/70">{description}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Tạo `src/components/ui/insight-card.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";
import type { PastelColor } from "./stat-card";

interface InsightCardProps {
  icon: IconName;
  iconColor?: PastelColor;
  title: string;
  description: string;
  detailsHref?: string;
  detailsLabel?: string;
  className?: string;
}

const iconBg: Record<PastelColor, string> = {
  peach: "bg-peach text-peach-ink",
  blue: "bg-blue text-blue-ink",
  mint: "bg-mint text-mint-ink",
  lilac: "bg-lilac text-lilac-ink",
};

export function InsightCard({
  icon,
  iconColor = "blue",
  title,
  description,
  detailsHref,
  detailsLabel = "Xem chi tiết",
  className,
}: InsightCardProps) {
  return (
    <div className={cn("bg-surface rounded-2xl p-5", className)}>
      <div className="flex items-center gap-3">
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", iconBg[iconColor])}>
          <Icon name={icon} size={20} />
        </div>
        <h4 className="text-sm font-medium text-ink">{title}</h4>
      </div>
      <p className="mt-3 text-xs text-muted leading-relaxed">{description}</p>
      {detailsHref && (
        <a
          href={detailsHref}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline"
        >
          {detailsLabel}
          <Icon name="arrowRight" size={16} />
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify + commit**

```powershell
npx tsc --noEmit
git add src/components/ui/card.tsx src/components/ui/bento-card.tsx src/components/ui/stat-card.tsx src/components/ui/promo-card.tsx src/components/ui/insight-card.tsx
git commit -m "feat(phase-2): data display A — Card, BentoCard, StatCard, PromoCard, InsightCard"
```

---

## Task 7: Data display B — ListItem, Badge, Avatar, Tooltip, DataTable

**Files:**
- Create: `src/components/ui/{list-item,badge,avatar,tooltip,data-table}.tsx`

- [ ] **Step 1: Tạo `src/components/ui/list-item.tsx`**

```tsx
import { cn } from "@/lib/cn";

interface ListItemProps {
  avatar?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

const baseClass =
  "w-full flex items-center gap-3 py-3 px-2 border-b border-border last:border-b-0 transition-colors";

export function ListItem({ avatar, title, subtitle, action, onClick, className }: ListItemProps) {
  const content = (
    <>
      {avatar && <div className="shrink-0">{avatar}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted truncate mt-0.5">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </>
  );

  // Split element returns — TypeScript narrow đúng theo element, tránh polymorphic spread.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(baseClass, "hover:bg-surface-muted text-left", className)}
      >
        {content}
      </button>
    );
  }
  return <div className={cn(baseClass, className)}>{content}</div>;
}
```

- [ ] **Step 2: Tạo `src/components/ui/badge.tsx`**

```tsx
import { cn } from "@/lib/cn";

export type BadgeVariant = "solid" | "soft" | "count";
export type BadgeSemantic = "neutral" | "success" | "warning" | "danger";

interface BadgeProps {
  variant?: BadgeVariant;
  semantic?: BadgeSemantic;
  withDot?: boolean;
  children?: React.ReactNode;
  className?: string;
}

const solidClass: Record<BadgeSemantic, string> = {
  neutral: "bg-ink text-white",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
};

const softClass: Record<BadgeSemantic, string> = {
  neutral: "bg-surface-muted text-ink-2",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  variant = "solid",
  semantic = "neutral",
  withDot,
  children,
  className,
}: BadgeProps) {
  if (variant === "count") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-medium bg-ink text-white",
          className
        )}
      >
        {children}
      </span>
    );
  }
  const classes = variant === "solid" ? solidClass[semantic] : softClass[semantic];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        classes,
        className
      )}
    >
      {withDot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Tạo `src/components/ui/avatar.tsx`**

```tsx
import { cn } from "@/lib/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

interface AvatarProps {
  src?: string;
  alt?: string;
  initials?: string;
  size?: AvatarSize;
  className?: string;
}

const sizeClass: Record<AvatarSize, string> = {
  xs: "w-6 h-6 text-xs",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

const pastels = ["bg-peach text-peach-ink", "bg-blue text-blue-ink", "bg-mint text-mint-ink", "bg-lilac text-lilac-ink"];

function pastelFromInitials(initials: string): string {
  const idx = initials.charCodeAt(0) % pastels.length;
  return pastels[idx];
}

export function Avatar({ src, alt, initials, size = "md", className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        className={cn("rounded-full object-cover", sizeClass[size], className)}
      />
    );
  }
  const text = (initials ?? "?").slice(0, 2).toUpperCase();
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-medium",
        sizeClass[size],
        pastelFromInitials(text),
        className
      )}
    >
      {text}
    </div>
  );
}

interface AvatarGroupProps {
  children: React.ReactNode;
  className?: string;
}

export function AvatarGroup({ children, className }: AvatarGroupProps) {
  return (
    <div className={cn("flex items-center [&>*]:ring-2 [&>*]:ring-surface [&>*+*]:-ml-2", className)}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Tạo `src/components/ui/tooltip.tsx`**

```tsx
"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export const TooltipProvider = RadixTooltip.Provider;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

export function Tooltip({ content, children, side = "top", delayDuration = 500 }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={cn(
            "rounded-sm bg-ink text-white text-xs px-2 py-1 shadow-popover z-50",
            "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out"
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-ink" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
```

- [ ] **Step 5: Tạo `src/components/ui/data-table.tsx`**

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface DataTableColumn<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = "Không có dữ liệu",
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey] as string | number;
        const bv = (b as Record<string, unknown>)[sortKey] as string | number;
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return sortDir === "asc" ? cmp : -cmp;
      })
    : data;

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className={cn("bg-surface rounded-lg overflow-hidden", className)}>
      <table className="w-full text-sm">
        <thead className="bg-surface-muted">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted",
                  col.className
                )}
              >
                {col.sortable ? (
                  <button
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                  >
                    {col.header}
                    {sortKey === col.key && (
                      <Icon
                        name="chevronDown"
                        size={16}
                        className={cn(sortDir === "asc" && "rotate-180")}
                      />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-8 text-muted text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={rowKey(row)} className="border-t border-border tabular-nums">
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-4 py-3 text-ink", col.className)}>
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Verify + commit**

```powershell
npx tsc --noEmit
git add src/components/ui/list-item.tsx src/components/ui/badge.tsx src/components/ui/avatar.tsx src/components/ui/tooltip.tsx src/components/ui/data-table.tsx
git commit -m "feat(phase-2): data display B — ListItem, Badge, Avatar, Tooltip, DataTable"
```

---

## Task 8: Feedback — Modal, Toast, AlertBanner, ProgressBar, Spinner, Skeleton, EmptyState

**Files:**
- Create: `src/components/ui/{modal,toast,alert-banner,progress-bar,spinner,skeleton,empty-state}.tsx`

- [ ] **Step 1: Tạo `src/components/ui/spinner.tsx`**

```tsx
import { cn } from "@/lib/cn";

export type SpinnerSize = 16 | 24 | 32;

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

export function Spinner({ size = 20, className }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("animate-spin", className)}
      role="status"
      aria-label="Đang tải"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Tạo `src/components/ui/skeleton.tsx`**

```tsx
import { cn } from "@/lib/cn";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "xs" | "sm" | "md" | "lg" | "full";
  className?: string;
}

const roundedClass = {
  xs: "rounded-xs",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
} as const;

export function Skeleton({ width, height = "1rem", rounded = "sm", className }: SkeletonProps) {
  return (
    <div
      style={{ width, height }}
      className={cn("bg-surface-muted shimmer", roundedClass[rounded], className)}
      aria-hidden="true"
    />
  );
}
```

- [ ] **Step 3: Tạo `src/components/ui/progress-bar.tsx`**

```tsx
"use client";

import * as RadixProgress from "@radix-ui/react-progress";
import { cn } from "@/lib/cn";

interface ProgressBarProps {
  value?: number; // 0-100; undefined = indeterminate
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ value, showLabel, className }: ProgressBarProps) {
  const indeterminate = value == null;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <RadixProgress.Root
        value={indeterminate ? undefined : value}
        className="relative w-full h-2 rounded-full bg-border overflow-hidden"
      >
        {indeterminate ? (
          <div className="absolute inset-0 shimmer bg-ink" />
        ) : (
          <RadixProgress.Indicator
            className="h-full rounded-full bg-ink transition-transform duration-200"
            style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
          />
        )}
      </RadixProgress.Root>
      {showLabel && !indeterminate && (
        <span className="text-xs text-muted tabular-nums w-10 text-right">{value}%</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Tạo `src/components/ui/empty-state.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  dashedBorder?: boolean;
  className?: string;
}

export function EmptyState({
  icon = "info",
  title,
  subtitle,
  action,
  dashedBorder,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center p-12 rounded-lg",
        dashedBorder && "border-2 border-dashed border-border",
        className
      )}
    >
      <Icon name={icon} size={24} className="text-muted mb-3" />
      <div className="text-base font-medium text-ink">{title}</div>
      {subtitle && <div className="mt-1 text-sm text-muted max-w-sm">{subtitle}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Tạo `src/components/ui/alert-banner.tsx`**

```tsx
"use client";

import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";
import { IconButton } from "./icon-button";

export type AlertVariant = "info" | "success" | "warning" | "danger";

interface AlertBannerProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

const variantClass: Record<AlertVariant, { bg: string; text: string; icon: IconName }> = {
  info: { bg: "bg-blue", text: "text-blue-ink", icon: "info" },
  success: { bg: "bg-success-soft", text: "text-success", icon: "checkCircle" },
  warning: { bg: "bg-warning-soft", text: "text-warning", icon: "alertTriangle" },
  danger: { bg: "bg-danger-soft", text: "text-danger", icon: "alertCircle" },
};

// danger/warning = alert (assertive), info/success = status (polite). A11y cho screen reader.
const variantRole: Record<AlertVariant, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "alert",
  danger: "alert",
};

export function AlertBanner({
  variant = "info",
  title,
  children,
  onClose,
  className,
}: AlertBannerProps) {
  const v = variantClass[variant];
  return (
    <div role={variantRole[variant]} className={cn("flex items-start gap-3 rounded-md px-4 py-3", v.bg, className)}>
      <Icon name={v.icon} size={20} className={cn("shrink-0 mt-0.5", v.text)} />
      <div className={cn("flex-1 text-sm", v.text)}>
        {title && <span className="font-semibold">{title} </span>}
        {children}
      </div>
      {onClose && (
        <IconButton
          icon="x"
          size={32}
          variant="ghost"
          onClick={onClose}
          aria-label="Đóng"
          className={cn(v.text, "hover:bg-black/5")}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Tạo `src/components/ui/modal.tsx`**

```tsx
"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

export const Modal = RadixDialog.Root;
export const ModalTrigger = RadixDialog.Trigger;

interface ModalContentProps extends React.ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  showClose?: boolean;
}

export const ModalContent = forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  ModalContentProps
>(function ModalContent({ className, children, showClose = true, ...rest }, ref) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
          "w-[min(90vw,28rem)] max-h-[85vh] overflow-auto",
          "bg-surface rounded-lg shadow-modal p-6",
          "focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out",
          className
        )}
        {...rest}
      >
        {children}
        {showClose && (
          <RadixDialog.Close asChild>
            <IconButton
              icon="x"
              size={32}
              variant="ghost"
              aria-label="Đóng"
              className="absolute right-4 top-4"
            />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
});

export const ModalTitle = forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(function ModalTitle({ className, ...rest }, ref) {
  return (
    <RadixDialog.Title
      ref={ref}
      className={cn("font-display text-xl font-bold text-ink", className)}
      {...rest}
    />
  );
});

export const ModalDescription = forwardRef<
  React.ElementRef<typeof RadixDialog.Description>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(function ModalDescription({ className, ...rest }, ref) {
  return (
    <RadixDialog.Description
      ref={ref}
      className={cn("mt-2 text-sm text-ink-2", className)}
      {...rest}
    />
  );
});

export function ModalActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-6 flex items-center justify-end gap-3", className)}>{children}</div>;
}

export const ModalClose = RadixDialog.Close;
```

- [ ] **Step 7: Tạo `src/components/ui/toast.tsx`**

```tsx
"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";

type ToastSemantic = "info" | "success" | "warning" | "danger";

interface ToastItem {
  id: string;
  title?: string;
  message: string;
  semantic: ToastSemantic;
}

interface ToastContextValue {
  toast: (input: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const semanticIcon: Record<ToastSemantic, IconName> = {
  info: "info",
  success: "checkCircle",
  warning: "alertTriangle",
  danger: "alertCircle",
};

const semanticColor: Record<ToastSemantic, string> = {
  info: "text-blue-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((input: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id, ...input }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <RadixToast.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            onOpenChange={(open) => {
              if (!open) setToasts((curr) => curr.filter((x) => x.id !== t.id));
            }}
            className={cn(
              "bg-surface rounded-md shadow-popover px-4 py-3 flex items-start gap-3 toast-enter transition-transform",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
              "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[calc(100%+1rem)] data-[swipe=end]:duration-100"
            )}
          >
            <Icon name={semanticIcon[t.semantic]} size={20} className={cn("shrink-0 mt-0.5", semanticColor[t.semantic])} />
            <div className="flex-1 min-w-0">
              {t.title && <RadixToast.Title className="text-sm font-semibold text-ink">{t.title}</RadixToast.Title>}
              <RadixToast.Description className="text-sm text-ink-2">{t.message}</RadixToast.Description>
            </div>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] z-50 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 8: Verify + commit**

```powershell
npx tsc --noEmit
git add src/components/ui/spinner.tsx src/components/ui/skeleton.tsx src/components/ui/progress-bar.tsx src/components/ui/empty-state.tsx src/components/ui/alert-banner.tsx src/components/ui/modal.tsx src/components/ui/toast.tsx
git commit -m "feat(phase-2): feedback — Modal, Toast, AlertBanner, ProgressBar, Spinner, Skeleton, EmptyState"
```

---

## Task 9: Charts — BarChart, LineChart

**Files:**
- Create: `src/components/charts/{bar-chart,line-chart}.tsx`

> **Recharts v3 type bridges (đã apply ở code thật):** `recharts ^3.x` thay đổi typing của `dataKey` (sang `TypedDataKey<T, any>`) và `<Tooltip content>` (stricter `ContentType`). Ba điểm cần cast trong mỗi chart file (BarChart + LineChart): `<XAxis dataKey={xKey as any}>`, `<Bar/Line dataKey={yKey as any}>`, `content={(<CustomTooltip ... />) as any}`. Mỗi cast kèm `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. Public component API (generic `<T extends Record<string, unknown>>`, `keyof T & string` cho key props) vẫn typed đầy đủ. Code template dưới giữ phong cách v2 cho rõ ý — khi implement, áp các cast như mô tả trên. File ground-truth là `src/components/charts/{bar,line}-chart.tsx` đã commit (`3ed464c`).

- [ ] **Step 1: Tạo `src/components/charts/bar-chart.tsx`**

```tsx
"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { cn } from "@/lib/cn";

interface BarChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  highlightKey?: keyof T & string;
  formatY?: (value: number) => string;
  height?: number;
  className?: string;
}

interface TooltipPayloadEntry {
  payload: Record<string, unknown>;
  value: number;
}

function CustomTooltip({ active, payload, label, formatY }: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: string; formatY?: (v: number) => string }) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value;
  return (
    <div className="rounded-sm bg-ink text-white text-xs px-2 py-1 shadow-popover flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-white" />
      <span className="tabular-nums">{formatY ? formatY(value) : value}</span>
    </div>
  );
}

export function BarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  yKey,
  highlightKey,
  formatY,
  height = 240,
  className,
}: BarChartProps<T>) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={data} margin={{ top: 24, right: 8, left: 0, bottom: 8 }}>
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
          />
          <YAxis hide />
          <RechartsTooltip
            cursor={false}
            content={<CustomTooltip formatY={formatY} />}
          />
          <Bar dataKey={yKey as string} radius={[8, 8, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={
                  highlightKey && entry[highlightKey]
                    ? "var(--color-ink)"
                    : "var(--color-border)"
                }
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Tạo `src/components/charts/line-chart.tsx`**

```tsx
"use client";

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/cn";

interface LineChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  formatY?: (value: number) => string;
  height?: number;
  className?: string;
}

function CustomTooltip({ active, payload, formatY }: { active?: boolean; payload?: Array<{ value: number }>; formatY?: (v: number) => string }) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value;
  return (
    <div className="rounded-sm bg-ink text-white text-xs px-2 py-1 shadow-popover flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-white" />
      <span className="tabular-nums">{formatY ? formatY(value) : value}</span>
    </div>
  );
}

export function LineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  yKey,
  formatY,
  height = 240,
  className,
}: LineChartProps<T>) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data} margin={{ top: 24, right: 8, left: 0, bottom: 8 }}>
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
          />
          <YAxis hide />
          <RechartsTooltip
            cursor={{ stroke: "var(--color-border)" }}
            content={<CustomTooltip formatY={formatY} />}
          />
          <Line
            type="monotone"
            dataKey={yKey as string}
            stroke="var(--color-ink)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: "var(--color-ink)" }}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

```powershell
npx tsc --noEmit
npm run build
```
Expected: cả hai PASS (build cần PASS để confirm recharts integrate clean với Next.js 15).

```powershell
git add src/components/charts
git commit -m "feat(phase-2): charts — BarChart, LineChart wrappers"
```

---

## Task 10: Playground — route + 7 sections

**Files:**
- Create: `src/app/playground/page.tsx`
- Create: `src/app/playground/_sections/{layout,buttons,form,navigation,data-display,feedback,charts}-section.tsx`

- [ ] **Step 1: Tạo `src/app/playground/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { LayoutSection } from "./_sections/layout-section";
import { ButtonsSection } from "./_sections/buttons-section";
import { FormSection } from "./_sections/form-section";
import { NavigationSection } from "./_sections/navigation-section";
import { DataDisplaySection } from "./_sections/data-display-section";
import { FeedbackSection } from "./_sections/feedback-section";
import { ChartsSection } from "./_sections/charts-section";
import { cn } from "@/lib/cn";

const sections = [
  { id: "layout", label: "Layout", Component: LayoutSection },
  { id: "buttons", label: "Buttons", Component: ButtonsSection },
  { id: "form", label: "Form", Component: FormSection },
  { id: "navigation", label: "Navigation", Component: NavigationSection },
  { id: "data-display", label: "Data display", Component: DataDisplaySection },
  { id: "feedback", label: "Feedback", Component: FeedbackSection },
  { id: "charts", label: "Charts", Component: ChartsSection },
] as const;

export default function PlaygroundPage() {
  const [active, setActive] = useState<typeof sections[number]["id"]>("layout");
  const Active = sections.find((s) => s.id === active)!.Component;

  return (
    <ToastProvider>
      <RadixTooltip.Provider>
        <div className="min-h-screen p-6">
          <div className="mx-auto max-w-[1500px] rounded-2xl bg-surface shadow-bento overflow-hidden">
            <div className="grid grid-cols-[240px_1fr]">
              <aside className="border-r border-border p-4">
                <div className="px-3 py-4 font-display text-xl font-bold">Playground</div>
                <nav className="flex flex-col gap-1 mt-2">
                  {sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActive(s.id)}
                      className={cn(
                        "text-left px-4 py-2.5 text-sm font-medium rounded-md transition-colors",
                        active === s.id
                          ? "bg-ink text-white rounded-full"
                          : "text-ink-2 hover:bg-surface-muted hover:text-ink"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </nav>
              </aside>
              <main className="p-8 overflow-auto max-h-screen">
                <Active />
              </main>
            </div>
          </div>
        </div>
      </RadixTooltip.Provider>
    </ToastProvider>
  );
}
```

- [ ] **Step 2: Tạo `src/app/playground/_sections/layout-section.tsx`**

```tsx
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar, SidebarSection, SidebarLogo } from "@/components/layout/sidebar";
import { NavItem } from "@/components/layout/nav-item";
import { TopBar, SearchBar } from "@/components/layout/top-bar";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar } from "@/components/ui/avatar";

export function LayoutSection() {
  return (
    <div className="space-y-8">
      <SectionTitle title="Layout primitives" />
      <div className="rounded-lg border border-border overflow-hidden">
        <AppShell
          sidebar={
            <Sidebar>
              <SidebarLogo>Chill</SidebarLogo>
              <SidebarSection label="Main">
                <NavItem icon="search" label="Dashboard" active />
                <NavItem icon="filter" label="Chốt két" />
                <NavItem icon="bell" label="Ca & lương" />
              </SidebarSection>
              <SidebarSection label="Tools">
                <NavItem icon="info" label="Cài đặt" />
              </SidebarSection>
            </Sidebar>
          }
          topBar={
            <TopBar
              search={<SearchBar />}
              actions={
                <>
                  <IconButton icon="bell" size={40} variant="ghost" aria-label="Notifications" />
                  <Avatar initials="OW" size="md" />
                </>
              }
            />
          }
        >
          <div className="text-ink-2">Content area</div>
        </AppShell>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="font-display text-3xl font-bold text-ink mb-2">{title}</h2>;
}
```

- [ ] **Step 3: Tạo `src/app/playground/_sections/buttons-section.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";

export function ButtonsSection() {
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Buttons</h2>
      <SubSection title="Button — variants">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </SubSection>
      <SubSection title="Button — sizes">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </SubSection>
      <SubSection title="Button — states">
        <div className="flex flex-wrap gap-3">
          <Button leadingIcon={<Icon name="plus" size={16} />}>With icon</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button square>Square radius</Button>
        </div>
      </SubSection>
      <SubSection title="IconButton — sizes & variants">
        <div className="flex flex-wrap items-center gap-3">
          <IconButton icon="bell" size={32} aria-label="32" />
          <IconButton icon="bell" size={40} aria-label="40" />
          <IconButton icon="bell" size={48} aria-label="48" />
          <IconButton icon="x" size={40} variant="secondary" aria-label="x" />
          <IconButton icon="x" size={40} variant="destructive" aria-label="x" />
          <IconButton icon="x" size={40} variant="ghost" aria-label="x" />
        </div>
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Tạo `src/app/playground/_sections/form-section.tsx`**

```tsx
"use client";

import { useState } from "react";
import { TextField } from "@/components/ui/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, Radio } from "@/components/ui/radio";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function FormSection() {
  const [radioValue, setRadioValue] = useState("a");
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Form controls</h2>
      <SubSection title="TextField">
        <div className="grid grid-cols-2 gap-4 max-w-xl">
          <TextField label="Email" placeholder="owner@chill.local" />
          <TextField label="Password" type="password" />
          <TextField label="Có error" defaultValue="invalid" error="Email không hợp lệ" />
          <TextField label="Disabled" disabled defaultValue="readonly" />
        </div>
      </SubSection>
      <SubSection title="Checkbox / Radio / Switch">
        <div className="flex flex-wrap gap-8">
          <div className="flex flex-col gap-2">
            <Checkbox label="Default" />
            <Checkbox label="Checked" defaultChecked />
            <Checkbox label="Disabled" disabled />
          </div>
          <RadioGroup value={radioValue} onValueChange={setRadioValue}>
            <Radio value="a" label="Option A" />
            <Radio value="b" label="Option B" />
            <Radio value="c" label="Option C (disabled)" disabled />
          </RadioGroup>
          <div className="flex flex-col gap-3">
            <Switch />
            <Switch defaultChecked />
            <Switch disabled />
          </div>
        </div>
      </SubSection>
      <SubSection title="Slider">
        <Slider defaultValue={[40]} max={100} step={1} className="max-w-md" formatValue={(v) => `${v}%`} />
      </SubSection>
      <SubSection title="Select">
        <Select defaultValue="apple">
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectItem value="cherry">Cherry</SelectItem>
          </SelectContent>
        </Select>
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Tạo `src/app/playground/_sections/navigation-section.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Stepper } from "@/components/ui/stepper";
import { Pagination } from "@/components/ui/pagination";

export function NavigationSection() {
  const [page, setPage] = useState(1);
  const [step] = useState(1);
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Navigation</h2>
      <SubSection title="Tabs">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">Overview content</TabsContent>
          <TabsContent value="details">Details content</TabsContent>
          <TabsContent value="settings">Settings content</TabsContent>
        </Tabs>
      </SubSection>
      <SubSection title="Breadcrumbs">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "#" },
            { label: "Settings", href: "#" },
            { label: "Account" },
          ]}
        />
      </SubSection>
      <SubSection title="Stepper">
        <Stepper
          steps={[
            { label: "Account" },
            { label: "Details" },
            { label: "Review" },
            { label: "Payment" },
          ]}
          current={step}
        />
      </SubSection>
      <SubSection title="Pagination">
        <Pagination total={5} current={page} onChange={setPage} />
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Tạo `src/app/playground/_sections/data-display-section.tsx`**

```tsx
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { BentoCard } from "@/components/ui/bento-card";
import { StatCard } from "@/components/ui/stat-card";
import { PromoCard } from "@/components/ui/promo-card";
import { InsightCard } from "@/components/ui/insight-card";
import { ListItem } from "@/components/ui/list-item";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

export function DataDisplaySection() {
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Data display</h2>
      <SubSection title="Card variants">
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Basic Card</CardTitle>
            </CardHeader>
            <CardBody>Card content here.</CardBody>
          </Card>
          <BentoCard>
            <CardTitle>Bento Card</CardTitle>
            <p className="text-sm text-muted mt-2">Larger radius, used in bento grids.</p>
          </BentoCard>
        </div>
      </SubSection>
      <SubSection title="StatCard pastels">
        <div className="grid grid-cols-4 gap-4">
          <StatCard color="peach" title="Doanh thu" subtitle="Hôm nay" value="₫2.5M" onAction={() => {}} />
          <StatCard color="blue" title="Khách" subtitle="Hôm nay" value="124" onAction={() => {}} />
          <StatCard color="mint" title="Lãi gộp" subtitle="Tháng này" value="38%" onAction={() => {}} />
          <StatCard color="lilac" title="Tăng trưởng" subtitle="So với tháng trước" value="+12%" onAction={() => {}} />
        </div>
      </SubSection>
      <SubSection title="PromoCard">
        <PromoCard
          badge="PRO"
          headline="Nâng cấp gói Analytics"
          description="Truy cập báo cáo nâng cao và xuất CSV."
          onAction={() => {}}
        />
      </SubSection>
      <SubSection title="InsightCard">
        <div className="grid grid-cols-3 gap-4">
          <InsightCard icon="checkCircle" iconColor="mint" title="Hoàn tất chốt két" description="Báo cáo hôm nay đã được tạo lúc 23:15." />
          <InsightCard icon="alertTriangle" iconColor="peach" title="Hết hàng" description="Cà phê arabica sắp hết tồn." />
          <InsightCard icon="sparkles" iconColor="lilac" title="Top sản phẩm" description="Cappuccino vẫn dẫn đầu tuần này." />
        </div>
      </SubSection>
      <SubSection title="Badge variants">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="solid" semantic="success">Active</Badge>
          <Badge variant="soft" semantic="success" withDot>Online</Badge>
          <Badge variant="soft" semantic="warning">Pending</Badge>
          <Badge variant="soft" semantic="danger">Failed</Badge>
          <Badge variant="count">3</Badge>
        </div>
      </SubSection>
      <SubSection title="Avatar group">
        <AvatarGroup>
          <Avatar initials="OW" />
          <Avatar initials="MA" />
          <Avatar initials="SO" />
          <Avatar initials="EV" />
        </AvatarGroup>
      </SubSection>
      <SubSection title="ListItem + Tooltip">
        <div className="bg-surface rounded-lg">
          <ListItem
            avatar={<Avatar initials="OW" />}
            title="Owner"
            subtitle="owner@chill.local"
            action={
              <Tooltip content="Vai trò: chủ quán">
                <Badge variant="soft" semantic="success">owner</Badge>
              </Tooltip>
            }
          />
          <ListItem
            avatar={<Avatar initials="ST" />}
            title="Staff A"
            subtitle="staff-a@chill.local"
          />
        </div>
      </SubSection>
      <SubSection title="DataTable">
        <DataTable
          columns={[
            { key: "name", header: "Tên", sortable: true },
            { key: "role", header: "Vai trò" },
            {
              key: "status",
              header: "Trạng thái",
              render: (r) =>
                r.status === "active" ? (
                  <Badge variant="soft" semantic="success" withDot>active</Badge>
                ) : (
                  <Badge variant="soft" semantic="warning">pending</Badge>
                ),
            },
          ]}
          data={[
            { id: 1, name: "Owner", role: "owner", status: "active" },
            { id: 2, name: "Staff A", role: "staff", status: "active" },
            { id: 3, name: "Staff B", role: "staff", status: "pending" },
          ]}
          rowKey={(r) => String(r.id)}
        />
      </SubSection>
      <SubSection title="EmptyState placeholder">
        <div className="text-muted text-sm">(EmptyState ở Feedback section)</div>
        <Button size="sm">Action</Button>
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 7: Tạo `src/app/playground/_sections/feedback-section.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Modal, ModalTrigger, ModalContent, ModalTitle, ModalDescription, ModalActions, ModalClose } from "@/components/ui/modal";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export function FeedbackSection() {
  const [progress, setProgress] = useState(30);
  const { toast } = useToast();

  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Feedback</h2>
      <SubSection title="Modal">
        <Modal>
          <ModalTrigger asChild>
            <Button>Open Modal</Button>
          </ModalTrigger>
          <ModalContent>
            <ModalTitle>Xác nhận xóa</ModalTitle>
            <ModalDescription>Hành động này không thể hoàn tác.</ModalDescription>
            <ModalActions>
              <ModalClose asChild>
                <Button variant="secondary">Hủy</Button>
              </ModalClose>
              <Button variant="destructive">Xóa</Button>
            </ModalActions>
          </ModalContent>
        </Modal>
      </SubSection>
      <SubSection title="Toast (click button trigger)">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => toast({ semantic: "info", message: "Thông báo info" })}>Info</Button>
          <Button onClick={() => toast({ semantic: "success", title: "Thành công", message: "Đã lưu" })}>Success</Button>
          <Button onClick={() => toast({ semantic: "warning", message: "Cảnh báo: kiểm tra lại" })}>Warning</Button>
          <Button onClick={() => toast({ semantic: "danger", message: "Có lỗi xảy ra" })}>Danger</Button>
        </div>
      </SubSection>
      <SubSection title="AlertBanner variants">
        <div className="space-y-2">
          <AlertBanner variant="info" title="Thông tin:">Server đang sync KiotViet.</AlertBanner>
          <AlertBanner variant="success" title="Thành công:">Báo cáo đã lưu.</AlertBanner>
          <AlertBanner variant="warning" title="Lưu ý:" onClose={() => {}}>Sắp hết hàng cà phê arabica.</AlertBanner>
          <AlertBanner variant="danger" title="Lỗi:">Không thể kết nối Supabase.</AlertBanner>
        </div>
      </SubSection>
      <SubSection title="ProgressBar">
        <div className="space-y-3">
          <ProgressBar value={progress} showLabel />
          <ProgressBar value={75} />
          <ProgressBar />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setProgress((p) => Math.max(0, p - 10))}>-10%</Button>
            <Button size="sm" onClick={() => setProgress((p) => Math.min(100, p + 10))}>+10%</Button>
          </div>
        </div>
      </SubSection>
      <SubSection title="Spinner sizes">
        <div className="flex items-center gap-4 text-ink">
          <Spinner size={16} />
          <Spinner size={24} />
          <Spinner size={32} />
        </div>
      </SubSection>
      <SubSection title="Skeleton">
        <div className="space-y-2 max-w-md">
          <Skeleton width="100%" height="1rem" />
          <Skeleton width="80%" height="1rem" />
          <Skeleton width="60%" height="1rem" />
          <div className="flex items-center gap-3 mt-4">
            <Skeleton width="2.5rem" height="2.5rem" rounded="full" />
            <Skeleton width="12rem" height="1rem" />
          </div>
        </div>
      </SubSection>
      <SubSection title="EmptyState">
        <EmptyState
          icon="info"
          title="Chưa có dữ liệu"
          subtitle="Tạo bản ghi đầu tiên để bắt đầu."
          action={<Button size="sm">Thêm mới</Button>}
          dashedBorder
        />
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 8: Tạo `src/app/playground/_sections/charts-section.tsx`**

```tsx
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";

const weekData = [
  { day: "T2", revenue: 1.2, highlight: false },
  { day: "T3", revenue: 1.8, highlight: false },
  { day: "T4", revenue: 2.4, highlight: true },
  { day: "T5", revenue: 1.6, highlight: false },
  { day: "T6", revenue: 2.0, highlight: false },
  { day: "T7", revenue: 2.8, highlight: false },
  { day: "CN", revenue: 2.2, highlight: false },
];

const trend = [
  { day: "T2", value: 50 },
  { day: "T3", value: 65 },
  { day: "T4", value: 60 },
  { day: "T5", value: 72 },
  { day: "T6", value: 80 },
  { day: "T7", value: 95 },
  { day: "CN", value: 88 },
];

export function ChartsSection() {
  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Charts</h2>
      <SubSection title="BarChart — doanh thu tuần (T4 highlight)">
        <BarChart
          data={weekData}
          xKey="day"
          yKey="revenue"
          highlightKey="highlight"
          formatY={(v) => `₫${v.toFixed(1)}M`}
        />
      </SubSection>
      <SubSection title="LineChart — xu hướng">
        <LineChart data={trend} xKey="day" yKey="value" formatY={(v) => `${v}`} />
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 9: Verify build + render**

```powershell
npx tsc --noEmit
npm run build
```
Expected: cả hai PASS, route list có `/playground`.

`npm run dev` rồi mở `http://localhost:3009/playground` (hoặc chạy qua Docker stack), bấm các tab section, kiểm tra:
- Mọi component hiển thị đủ states.
- Tab/Shift+Tab điều hướng được mọi interactive.
- Focus ring `2px ink` xuất hiện trên `:focus-visible`.
- Modal mở/đóng (click trigger + Esc + click backdrop).
- Toast bấm trigger thấy slide-in góc phải dưới, tự ẩn sau 4s.
- Slider drag hoạt động.
- DataTable click cột "Tên" → sort.
- Pagination click chuyển trang.
- BarChart highlight bar T4 màu ink, các bar khác màu border.

- [ ] **Step 10: Commit**

```powershell
git add src/app/playground
git commit -m "feat(phase-2): /playground route + 7 section pages"
```

---

## Task 11: Final verification + merge prep

- [ ] **Step 1: Theme-able proof**

Tạm sửa `src/app/layout.tsx` thêm `data-theme="dark"` lên `<html>` (CHỈ để test, sẽ revert):
```tsx
<html lang="vi" suppressHydrationWarning data-theme="dark" className={`${sans.variable} ${display.variable}`}>
```
Run: `npm run build`.
Expected: PASS không lỗi. Mở `/playground` (qua `npm run dev`): mọi component vẫn render được (fallback light values vì `[data-theme="dark"]` chưa có rule override).

Sau khi xác nhận, REVERT `data-theme="dark"`:
```tsx
<html lang="vi" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
```

- [ ] **Step 2: Smoke Phase 1 still passes** (đảm bảo không hỏng nền tảng)

```powershell
$env:OWNER_EMAIL = "owner@chill.local"
$env:OWNER_PASSWORD = "chill-owner-2026"
npm run smoke
```
Expected: `Smoke test PASS.` Stack vẫn UP từ Phase 1 / 8.

Nếu stack đang down (do dev tắt máy giữa chừng), bring up trước:
```powershell
docker compose up -d
```
Đợi `chill-app (healthy)`, rồi `npm run smoke`.

- [ ] **Step 3: TypeScript + build clean toàn dự án**

```powershell
npx tsc --noEmit
npm run build
```
Expected: cả hai PASS, không cảnh báo Tailwind hay font.

- [ ] **Step 4: Acceptance checklist mắt-thường trên `/playground`** (đối chiếu `design.md`):
  - [ ] AppShell có gradient bg ấm + main bento card `rounded-2xl shadow-bento`.
  - [ ] Sidebar 240px; NavItem active = `bg-ink rounded-full`.
  - [ ] TopBar search pill `rounded-full bg-surface-muted` + ⌘F kbd hint.
  - [ ] Button primary = dark pill; Loading state có spinner thay icon; Destructive = đỏ.
  - [ ] IconButton 32/40/48 round.
  - [ ] TextField default/focus/error/disabled rõ ràng.
  - [ ] Checkbox/Radio/Switch checked = ink.
  - [ ] Slider value tooltip pill đen.
  - [ ] Select chevron + dropdown shadow popover.
  - [ ] Tabs active underline `2px bg-ink`.
  - [ ] Stepper completed/current/upcoming hiển thị đúng.
  - [ ] Pagination current = `bg-ink text-white`.
  - [ ] StatCard 4 pastels (peach/blue/mint/lilac) + big number font-display tabular-nums + arrow round button góc dưới.
  - [ ] PromoCard dark gradient + badge PRO pill.
  - [ ] InsightCard icon tròn pastel.
  - [ ] Badge solid/soft/count đủ.
  - [ ] DataTable header bg-muted uppercase text-xs + sort indicator click hoạt động.
  - [ ] Modal backdrop blur + container shadow-modal; destructive action đỏ.
  - [ ] Toast trượt từ phải vào, tự ẩn sau ~4s.
  - [ ] AlertBanner 4 variants màu soft.
  - [ ] ProgressBar + Spinner + Skeleton (có shimmer) hoạt động.
  - [ ] EmptyState dashed border + icon mờ + CTA.
  - [ ] BarChart bar bo góc trên + tooltip pill đen + không gridline + bar highlight ink.
  - [ ] LineChart smooth line ink + tooltip pill đen.

- [ ] **Step 5: Tag Phase 2 done**

```powershell
git tag v4-phase-2
git log --oneline -15
git rev-parse v4-phase-2
```
Expected: tag tạo thành công, log liệt kê các commit Phase 2 (Task 1–10).

---

## Self-Review (đã rà theo spec)

- **Spec coverage:** mọi component trong spec (Sec 5) có task tương ứng (Task 2–9). Foundation (tokens, fonts, deps, cn, Icon) — Task 1. Playground — Task 10. Verification — Task 11. ✓
- **Placeholder scan:** không có "TBD/TODO" trong code; dependency versions dùng `^1.x`/`^2.x` là chỉ mục semver-style (npm resolve thực tế khi install).
- **Type consistency:** `cn` từ `@/lib/cn` được dùng nhất quán; `Icon`/`IconName` từ `@/components/ui/icons` nhất quán; `ButtonVariant` re-used trong `IconButton`; `PastelColor` re-used trong `StatCard` + `InsightCard`. ✓
- **Phụ thuộc giữa task:** Task 1 (Foundation) là tiền đề; Task 3 dùng `Icon` từ Task 1; Task 8 (Modal/Toast) dùng `IconButton`/`Button` từ Task 3 + `Icon`; Task 10 (Playground) dùng tất cả. Thứ tự đúng. ✓

---

## Execution Handoff

**Plan saved to `docs/superpowers/plans/2026-05-20-v4-phase-2-design-system.md`.**

Sau khi user duyệt plan này, hai phương án thực thi:

1. **Subagent-Driven (đề xuất)** — dispatch fresh subagent per task, 2-stage review (spec + code quality) giữa các task. Cùng phong cách Phase 1.
2. **Inline Execution** — chạy task trong session hiện tại, checkpoint review theo nhóm task.

**Khi user chọn:**
- Nếu **Subagent-Driven** → REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
- Nếu **Inline Execution** → REQUIRED SUB-SKILL: `superpowers:executing-plans`.
