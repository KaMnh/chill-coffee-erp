# Mobile UI/UX Design — Chill Coffee ERP

**Ngày:** 2026-06-11 · **Trạng thái:** Mockup đã dựng (route `/mobile`), chờ wiring thật
**Preview:** `src/app/(preview)/mobile` — mock data thuần client, KHÔNG gọi DB/API
**Phạm vi:** 11 view + Đăng nhập (codebase hiện có 11 view — thêm `cashflow` "Dòng tiền" so với 10 view trong đề bài)

---

## 1. Nav model (chốt)

**Bỏ sidebar 240px trên mobile.** Bottom tab bar 4 đích + tab **"Thêm"** mở drawer
(bottom sheet). **Role-aware** — nguồn label/icon: `NAV_ITEMS` trong
`src/features/navigation/navigation.ts`, nhóm drawer theo `NAV_GROUPS`.

| Role | 4 tab chính | Drawer "Thêm" (theo nhóm) |
|---|---|---|
| **Nhân viên vận hành** | Trang chủ · Chốt két · Chi phí · Bàn giao | Nhân sự & Ca: Ca & lương · Kho hàng: Kho · Báo cáo: Báo cáo |
| **Chủ quán** | Trang chủ · Sổ quỹ · Báo cáo · Chốt két | Tổng quan: Dòng tiền · Thu–Chi–Quỹ: Chi phí · Nhân sự & Ca: Bàn giao, Ca & lương · Kho hàng: Kho · Báo cáo: Pivot · Hệ thống: Thiết lập |
| Manager (wiring sau) | như owner nhưng bỏ Sổ quỹ → thay bằng Chi phí | phần còn lại theo role matrix |

- Tab active = **dark pill** (đúng convention nav active của design system).
- Tab "Thêm" active khi view hiện tại nằm ngoài 4 tab. Chấm đỏ cảnh báo trên tab
  (vd Bàn giao còn việc) khi vượt ngưỡng.
- Drawer: hàng 48px, icon + label + chevron, hàng tài khoản + Đăng xuất ở cuối.
- Đổi role làm view hiện tại mất quyền → snap về `dashboard`
  (mirror `useRoleGate`).

**Top app bar gọn:** tiêu đề ngữ cảnh view + chip chọn ngày (input date thật,
hiển thị dd/MM) + nút sync + avatar. **Logout gộp vào menu avatar** (tên + role
badge + Đăng xuất). Search desktop bỏ — view nào cần tìm kiếm thì đặt trong view.

**Desktop giữ nguyên** sidebar + TopBar hiện tại; mobile là nhánh thêm.

## 2. Chiến lược breakpoint

- **Mobile < 768px** (`md:` của Tailwind là mốc chuyển). AppShell hiện đã có
  hamburger drawer ở `<lg`; bản wiring thật sẽ thay nhánh `<md` bằng bottom tab
  + drawer như mockup, giữ `md–lg` dùng hamburger hiện có, `≥lg` sidebar dock.
- Không thêm hook `useMediaQuery` cho layout — ưu tiên CSS responsive
  (`hidden md:block`…). JS chỉ gate **animation** qua `gsap.matchMedia()`.
- Safe-area: `viewport-fit=cover` (đã thêm) + `env(safe-area-inset-top/bottom)`
  cho top bar / bottom tab. Trong preview mô phỏng bằng CSS var
  `--pv-safe-top/--pv-safe-bottom` (desktop bezel) và fallback `env()` trên máy thật.

## 3. Pattern mobile bắt buộc (đã áp trong mockup)

- **Touch target ≥44px**: mọi nút/stepper/chip dùng `h-11`+ (44px), hàng list 48–56px.
- **Action chính sticky đáy** (thumb zone), full-width — Chốt két, Bàn giao;
  FAB cho Chi phí. Sticky bar đặt **trong** scroll container (`sticky bottom-0`).
- **Modal → bottom sheet**: primitive `Sheet` (kéo tay cầm xuống >80px để đóng,
  Esc, chạm backdrop; `role=dialog aria-modal`; portal vào khung máy).
- **Bảng → card list**; bảng buộc giữ dạng bảng (Pivot) → **scroll ngang +
  cột đầu sticky** + gợi ý vuốt.
- **Input số VND**: `inputMode="numeric"`, font ≥16px (chống auto-zoom iOS),
  nút xóa nhanh, hiển thị dấu chấm nghìn (`MoneyField` trong mockup).
- **3 state mọi data view**: loading = Skeleton, empty = EmptyState,
  error = AlertBanner (kịch bản "Ngày cảnh báo" demo POS sync lỗi).

## 4. Adaptation từng view

### Tier A (fidelity cao + đủ states)

- **Chốt két** *(then chốt)* — redesign denomination grid:
  - Mỗi mệnh giá = **1 hàng full-width 2 tầng**: tầng trên nhãn (`500.000 ₫`) +
    tổng dòng căn phải; tầng dưới stepper **−/＋ 44px** + ô số numeric 64px +
    **chip +5/+10/+20** wrap xuống (stepper đã là ±1 nên bỏ chip +1).
  - Segmented 2 bước (Đếm cuối ngày / Để lại ngày mai); bước 2 có recap 3 ô
    (Đếm cuối ngày / Để lại mai / Nạp sổ quỹ) + chặn để-lại > đếm-thực.
  - **Đối soát thu gọn**: card accordion "Khớp · 0 ₫" (xanh) / "Lệch ±X" (đỏ),
    mở ra dl 2 cột đúng công thức `cash-math.ts`.
  - **Sticky đáy**: tổng + nút "Tiếp · bước 2" / "Chốt két & tạo báo cáo · nạp quỹ X"
    + "Kiểm nhanh". Tiền đầu ngày = card bấm mở sheet chi tiết.
- **Bảng vận hành**: 1 cột. KPI 2-up (Thu POS mint / Tổng chi peach, CountUp) +
  **hàng chip KPI phụ cuộn ngang** (lương, đang trong ca, giờ cao điểm);
  shortcut 2 cột; bàn giao = card tiến độ; sales feed + sổ chi = list.
  **Owner: thứ tự ưu tiên thị giác** — Tin được (chip sync) → Tiền (KPI) →
  Thanh khoản (két + sổ quỹ, *đề xuất*) → Hiệu quả (chip) → **Cảnh báo chỉ hiện
  khi vượt ngưỡng** (két lệch / chưa check-out / sắp hết kho — bấm nhảy thẳng view).
- **Bàn giao**: checklist = hàng ≥56px bấm cả hàng (tick pop GSAP), "Đã làm lúc…";
  ghi chú autosave-on-blur + đếm ký tự; cảnh báo còn người trong ca;
  **"Hoàn tất bàn giao" sticky** → sheet xác nhận (cảnh báo task chưa xong, khóa session).
- **Chi phí**: form-first — **FAB ＋** (sticky đáy phải) mở **sheet**: mẫu nhanh
  cuộn ngang (label + giá), **số tiền lớn** (MoneyField), hạng mục **chip**,
  nội dung, nút "Lưu khoản chi · X ₫"; lịch sử = card list + tổng ngày; lưu xong
  prepend list + toast.

### Tier B (layout-level)

- **Ca & lương**: 2 section card list (Đang làm việc / Chưa vào ca); nút
  **Vào ca / Ra ca full-width h-12** trong card; Lương theo lượt = section gập
  được (tổng + rows, badge "Đã sửa").
- **Sổ quỹ** *(owner)*: card peach **Tổng quỹ** (CountUp) + 2 card quỹ
  (tiền mặt / chuyển khoản); hành động 2×2; demo sheet **"Rút khác"** với
  **fund-split tự động CK-trước** (đúng `defaultFundSplit`) + hạng mục chip;
  lịch sử = list ± màu + số dư sau; "Tải thêm 90 ngày trước".
- **Kho**: 5 tab = **pill cuộn ngang sticky** dưới top bar; Tồn kho/Nguyên liệu/
  Sản phẩm = card list (badge Âm/Sắp hết); Công thức = list + *đề xuất recipe
  builder full-screen*; Tổng quan = KPI 2-up + "Cần nhập sớm".
- **Báo cáo**: 5 tab pill cuộn ngang; tab Chốt két: **chip ngày** (thay sidebar
  320px desktop) + phiếu chốt két dạng card + nút **Tải ảnh/In** (giữ
  `html-to-image` + `window.print`); các tab khác = card list; **Theo giờ** =
  bar chart, mobile **ẩn nhãn trục còn mỗi 3h** (mockup dùng CSS bars; build thật:
  Recharts `ResponsiveContainer`, tick 3h, font 10px).
- **Pivot**: bảng `min-w-[480px]` trong `overflow-x-auto overscroll-x-contain`,
  **cột "Hóa đơn" sticky trái** (header + cell), gợi ý "Vuốt ngang…".
- **Dòng tiền**: KPI mint nổi bật (Chênh lệch) + 2 card vào/ra; chart Thu/Chi
  7 ngày (CSS bars; build thật Recharts ComposedChart); Hạng mục chi = progress %;
  *lịch âm dương để desktop*.
- **Thiết lập**: list row native (icon + label + control phải: chevron/Switch/
  badge), section Vận hành / Kết nối / Dữ liệu (owner); mỗi row mở màn
  full-screen khi build thật.
- **Đăng nhập**: full-screen 1 cột, logo + field h-12 text-base,
  `type=email` + `autoComplete=current-password`, autofocus email,
  **CTA "Đăng nhập" ghim đáy**.

## 5. Danh sách component cần sửa khi build thật

| Component | Việc cần làm | Ghi chú từ khảo sát |
|---|---|---|
| `layout/app-shell.tsx` | Thêm nhánh `<md`: bottom tab + drawer "Thêm" (thay hamburger ở mobile); giữ `md–lg` hamburger, `≥lg` sidebar | đã responsive 1 phần (Radix drawer `<lg`) |
| `layout/top-bar.tsx` | Variant mobile: title ngữ cảnh + date chip dd/MM + sync + avatar menu (gộp logout) | hiện đã ẩn search `<sm` |
| `ui/modal.tsx` | Thêm **variant sheet** cho `<md` (Radix Dialog giữ a11y, content `bottom-0 rounded-t-2xl` + GSAP) — desktop giữ centered | nội dung modal nào có `grid-cols-3` cứng phải responsive (`edit-cash-count-modal`) |
| `ui/data-table.tsx` | Thêm **card mode** (`<md`: mỗi row = card, cột phụ thành dòng phụ) hoặc scroll mode + sticky col; wrapper hiện là `overflow-hidden` → **clip nội dung ở 375px** | dùng ở Sổ quỹ (8 cột!), Pivot, Settings |
| `features/cash/denomination-grid.tsx` | Layout mobile = hàng 2 tầng như mockup (`grid-cols-[100px_auto_1fr_auto]` chỉ giữ `≥md`) | tác vụ quan trọng nhất của thu ngân |
| `app/layout.tsx` + `app/manifest.ts` | **ĐÃ LÀM** trong nhánh này (viewport + theme-color + manifest + apple icons) | — |
| `ui/progress-bar.tsx` | **ĐÃ LÀM**: nhận `aria-label` (axe aria-progressbar-name) | — |
| `ui/pagination.tsx` | `>7` trang tràn 375px → rút gọn (1 … n) hoặc Prev/Next-only mobile | |
| `ui/list-toolbar.tsx` | `min-w-[12rem]`+`min-w-[10rem]` → xếp 2 hàng gọn ở mobile | Sổ quỹ filter 3 control |
| `ui/stepper.tsx` | Label dài tiếng Việt vỡ ở 375px → ẩn label, chỉ số + check ở mobile | |
| `features/reports/printable-report.tsx` | `max-w-[16cm]` + dl 2 cột chật ở 375px; export JPEG theo width màn → chốt width cố định khi export | giữ chức năng JPEG |
| `features/shifts/employee-grid.tsx` | Hàng name + badge + 3 nút không wrap → tách nút xuống hàng (như mockup) | |
| `features/settings/*` | Bảng tài khoản/role-matrix → card list / màn riêng mobile | matrix 5 cột ~500px |

## 6. PWA

- `src/app/manifest.ts` (**đã làm**): name "Chill Coffee ERP" / short_name
  "Chill Coffee", `display: standalone`, `start_url: "/"`,
  `background_color`/`theme_color: #FAF7F2` (`--color-bg-app-from`),
  icon 192/512 + 512-maskable (đã có sẵn trong `public/`).
- `layout.tsx` (**đã làm**): `export const viewport` — `themeColor #FAF7F2`,
  `viewportFit: "cover"`; `metadata.appleWebApp` + `icons.apple`
  (`/apple-touch-icon.png`).
- **Lưu ý:** Lighthouse ≥12 đã **bỏ category PWA** — không còn điểm
  "PWA installable". Installability xác minh theo tiêu chí cài đặt Chrome:
  manifest hợp lệ (name, icon ≥192, standalone, start_url) + secure context.
  Đã verify: `/manifest.webmanifest` + 4 icon đều 200, `<link rel=manifest>` +
  `theme-color` + `viewport-fit=cover` render trên mọi page.
- Service worker/offline: **ngoài phạm vi** (không cần cho installability).

## 7. Animation policy (GSAP)

- **Nguồn duy nhất:** import từ `@/lib/gsap` (đăng ký plugin + defaults sẵn);
  tái dùng primitives `Reveal` (stagger/onScroll) + `CountUp`. Timing theo
  `DUR`/`STAGGER`.
- **Chỉ transforms + autoAlpha** (`x/y/yPercent/scale`), không animate
  width/height/top/left.
- **Reduced-motion:** convention repo = `prefersReducedMotion()` ở đầu mỗi
  animation (Reveal/CountUp/Sheet/tick/FAB đều theo). Nhánh reduce của Sheet
  dùng **`gsap.set`** (đồng bộ, không chờ ticker — tránh trễ khi rAF bị
  throttle). Đã verify runtime: bật reduce → sheet hiện/ẩn tức thì, list
  không stagger (opacity 1 ngay).
- **`gsap.matchMedia()`**: dùng khi wiring thật để gate animation **chỉ chạy ở
  breakpoint mobile** (`(max-width: 767px)` + điều kiện reduce). Trong preview
  khung máy luôn là "mobile" nên không gate breakpoint.
- ⚠️ **Bài học:** KHÔNG đặt class transform của Tailwind (`translate-y-full`…)
  lên element mà GSAP điều khiển — GSAP import translateY của class thành `y`
  px nền và làm bẩn mọi tween sau (sheet "mở" nhưng nằm ngoài khung).
  GSAP set vị trí ban đầu trong `useGSAP` (layout effect, trước paint) nên
  không cần class + không flash.
- Micro-interactions trong mockup: sheet trượt + kéo-để-đóng, drawer, tab pill
  pop (`back.out`), FAB scale-in, tick checklist pop, stagger list khi vào màn,
  title bar fade, CountUp tiền.

## 8. Cấu trúc preview & cách chạy

```
src/app/(preview)/mobile/
  page.tsx                 — metadata (noindex) + PreviewShell
  _mock/data.ts            — toàn bộ mock (VND, tiếng Việt, 2 kịch bản on/warn)
  _components/
    preview-shell.tsx      — panel điều khiển (role + kịch bản) + khung máy
    phone-frame.tsx        — bezel 390px / full-screen <md; PhonePortalContext
    mobile-app.tsx         — view-switcher trong máy (login ↔ app)
    mobile-nav.ts          — TABS_BY_ROLE / DRAWER_BY_ROLE / VIEW_TITLES
    mobile-top-bar.tsx, bottom-tab-bar.tsx, more-drawer.tsx
    sheet.tsx              — bottom-sheet primitive (GSAP + drag)
    bits.tsx               — PreviewContext, SuggestNote, ViewStates, MoneyField, Chip
    views/                 — 11 view + login
```

- Chạy: `npm run dev` → `http://localhost:3009/mobile`. Panel trái (desktop)
  hoặc thanh chip trên (mobile) đổi **Vai trò** (Nhân viên/Chủ quán) và
  **Kịch bản** (Ngày ổn / Ngày cảnh báo / Đang tải / Trống).
- Chip **"Đề xuất"** (cam, viền đứt) đánh dấu phần chưa có data thật / quyết
  định cho phase wiring.
- Mock số liệu khớp công thức thật (vd đối soát Chốt két lệch 0 ₫ ở "Ngày ổn",
  +50.000 ₫ ở "Ngày cảnh báo"; fund-split CK-trước của Sổ quỹ).

## 9. Kết quả verify (2026-06-11)

- `npx tsc --noEmit` ✓ 0 lỗi · `vitest run` ✓ 206/206.
- 375×812: **không tràn ngang** ở mọi view đã duyệt (docScrollWidth = 375,
  0 offender ngoài vùng scroll chủ đích); tab bar đáy đúng viewport.
- 11 view + login **đều reachable** qua tab/drawer/avatar-menu cho cả 2 role.
- Sheet: mở/đóng + kéo-để-đóng OK; reduce → tức thì (runtime-verified).
- Console: 0 error (chỉ warning Next/Image `chill-logo.png` — pre-existing,
  màn login thật cũng có).
- Lighthouse (dev, mobile, route /mobile): A11y 94 · Best Practices 81 · SEO 90.
  Đã sửa: thiếu `<main>`, meta description, aria-progressbar-name,
  label-content-name-mismatch (avatar). Còn lại do dev/localhost (https, llms.txt).
- PWA: manifest + icons + theme-color + viewport-fit verify 200/đầy đủ
  (Lighthouse ≥12 không còn category PWA — xem §6).
