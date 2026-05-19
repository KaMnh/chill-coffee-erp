# Phong cách thiết kế Dashboard – Style Guide cho Claude Code

## Tổng quan phong cách

Đây là phong cách **modern bento dashboard** với cảm giác mềm mại, nhẹ nhàng và premium. Đặc trưng:

- **Bento grid layout**: các khối nội dung sắp xếp dạng "hộp cơm bento" – nhiều card với kích thước khác nhau ghép lại
- **Rounded everything**: bo góc lớn (radius khoảng `1rem` đến `1.5rem` cho card, `9999px` cho pill/button)
- **Card-based với nền nhạt**: toàn bộ giao diện đặt trên một card lớn bo góc, có shadow nhẹ, nổi trên background gradient
- **Soft shadows**: shadow rất nhẹ, lan rộng (`shadow-sm` hoặc `shadow-md` với opacity thấp)
- **Pastel + dark contrast**: card chính dùng màu pastel/trắng, các CTA và active state dùng nền tối (gần đen) để tương phản mạnh

## Layout structure

```
┌─────────────────────────────────────────────────────────┐
│  [Outer container: gradient background, padding lớn]    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  [Main card: white/cream bg, rounded-3xl, shadow] │  │
│  │  ┌──────┬─────────────────────────────────────┐   │  │
│  │  │      │  Top bar (search + avatar)          │   │  │
│  │  │ Side │─────────────────────────────────────│   │  │
│  │  │ bar  │  Greeting (Hello + subtitle)        │   │  │
│  │  │      │─────────────────────────────────────│   │  │
│  │  │      │  ┌────┬────┬────┐ ┌──────────────┐  │   │  │
│  │  │      │  │Stat│Stat│Stat│ │ Promo card   │  │   │  │
│  │  │      │  └────┴────┴────┘ └──────────────┘  │   │  │
│  │  │      │  ┌──────────────────┐ ┌──────────┐  │   │  │
│  │  │      │  │ Chart section    │ │ Insights │  │   │  │
│  │  │      │  ├──────────────────┤ │ list     │  │   │  │
│  │  │      │  │ Data table       │ │          │  │   │  │
│  │  │      │  └──────────────────┘ └──────────┘  │   │  │
│  │  └──────┴─────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Grid chính**: 12 cột, sidebar chiếm ~2 cột, content chiếm ~10 cột. Trong content area, chia tiếp thành 2 cột chính (~7/3 hoặc 8/4 tỉ lệ) cho main + insights panel.

## Sidebar

- Width cố định, khoảng `220-240px`
- Background trùng với main card (không tách màu)
- **Logo** ở top: icon + wordmark, padding thoáng
- **Section header**: chữ nhỏ uppercase, opacity thấp, làm label cho nhóm menu (vd: "Main", "Tools")
- **Menu items**:
  - Inactive: icon + text, màu xám trung tính, không có background
  - Active: nền **đen/dark pill** bo tròn hoàn toàn (`rounded-full`), text trắng, padding ngang rộng
  - Hover: background xám nhạt, transition mượt
- Icons dùng line-style (Lucide hoặc tương tự), stroke mảnh

## Top bar

- **Search bar** chiếm phần lớn chiều ngang:
  - Background xám rất nhạt, bo tròn (`rounded-full`)
  - Icon search bên trái
  - Placeholder text
  - **Keyboard shortcut hint** bên phải (vd `⌘F`) trong một pill nhỏ
- **Action group** bên phải: notification bell icon + avatar tròn (có thể có ring/border)

## Greeting section

- Heading lớn (`text-3xl` đến `text-4xl`), font weight bold
- Subtitle nhỏ ngay dưới, màu xám, single line mô tả ngắn

## Stats cards (KPI cards)

Layout: 3 card ngang hàng, kích thước bằng nhau

- Mỗi card có **màu pastel khác nhau** (peach, blue, gray-blue, mint... tùy project)
- Bo góc `rounded-2xl`
- Padding lớn (`p-5` đến `p-6`)
- Cấu trúc nội dung:
  - **Title** ở top (medium weight)
  - **Subtitle** nhỏ dưới title
  - **Số liệu lớn** (`text-3xl` đến `text-4xl`, bold) ở dưới cùng
  - **Arrow button** dạng nút tròn đen (`rounded-full`, bg đen, icon mũi tên chéo lên) ở góc dưới phải
- Có thể có **decoration nhẹ** (blob/shape mờ) ở background card

## Promo card (CTA card)

- Background **dark gradient** hoặc image với overlay tối
- Bo góc `rounded-2xl`
- **Badge "PRO"** nhỏ ở góc trên trái (pill với icon)
- **Headline 2 dòng** font lớn, màu trắng
- **Arrow button** tròn (trắng hoặc trong suốt với border) ở góc trên phải
- Phía trên promo card có thể có **stat strip** (vd "16 hours saved this month" – "14 hours saved previous month") với icon tròn màu

## Chart section (Productivity / Trends)

- Card trắng, bo góc lớn
- Header: title + subtitle bên trái, **dropdown filter** ("Week ▼") bên phải (pill style, border xám nhạt)
- Body chia 2 phần:
  - **Left**: stat lớn (số + đơn vị) + caption + **badge tăng trưởng** (vd "+15% vs last week", màu xanh, pill bo tròn, nền xanh nhạt)
  - **Right**: bar chart
- **Bar chart style**:
  - Bars bo góc trên (`rounded-t-lg`)
  - Một số bar có **gradient/pattern** (vd diagonal stripes) để highlight
  - Bar được chọn có **tooltip pill đen** phía trên hiển thị giá trị + dot indicator
  - Label ngày dưới mỗi bar (Sun, Mon, Tue...)
  - Không có gridlines hoặc rất mờ

## Insights panel (right column)

Stack dọc gồm nhiều card nhỏ giống nhau:

- Mỗi card: background trắng/xám rất nhạt, bo `rounded-2xl`, padding vừa
- Header row: **icon tròn màu** (bg pastel khác nhau cho từng loại: tím, cam, xanh lá) + title bên cạnh
- Body: 1-2 dòng mô tả, màu xám
- Footer: link "View Details →" màu primary, có icon mũi tên nhỏ

## Performance table

- Card trắng bo góc, header có title
- Table không có border đậm, chỉ separator rất mờ giữa các row (hoặc bỏ luôn)
- Header row: text uppercase nhỏ hoặc medium, màu xám
- Data row: padding cao, text size vừa
- **Status column** dùng badge pill với màu semantic:
  - Success: nền xanh nhạt, text xanh đậm, có dot prefix
  - Warning: nền cam nhạt, text cam
  - Failed: nền đỏ nhạt, text đỏ
  - Tất cả đều bo `rounded-full`

## Typography

- **Font family**: sans-serif hiện đại (Inter, Geist, Plus Jakarta Sans, hoặc tương tự)
- **Hierarchy**:
  - H1 (greeting): `text-3xl/4xl`, `font-bold`, tracking hơi tight
  - Section title: `text-lg/xl`, `font-semibold`
  - Big number (KPI): `text-3xl/4xl`, `font-bold`
  - Body: `text-sm`, `font-normal`
  - Caption/subtitle: `text-xs/sm`, `text-muted-foreground`
- Line height thoáng, letter-spacing default

## Spacing & shadows

- **Spacing scale** rộng rãi: gap giữa các card `gap-4` đến `gap-6`, padding trong card `p-5` đến `p-6`
- **Shadow**:
  - Card chính ngoài cùng: shadow lan rộng, opacity thấp (`shadow-2xl` với màu mềm)
  - Card con bên trong: thường **không có shadow** hoặc shadow rất nhẹ, dựa vào contrast màu nền
- **Border**: gần như không dùng border đậm; nếu có thì `border` với màu xám rất nhạt (`border-gray-100/200`)

## Interactive elements

- **Buttons (primary)**: nền đen, text trắng, bo `rounded-full`, icon + text, padding ngang rộng
- **Icon buttons**: tròn hoàn toàn, kích thước cố định (`w-9 h-9` hoặc `w-10 h-10`), nền đen hoặc nền trong suốt với border
- **Dropdowns**: pill style, border xám nhạt, có chevron icon
- **Badges**: luôn `rounded-full`, padding ngang vừa, có thể có dot prefix
- **Hover states**: subtle (đổi opacity, đổi nền nhẹ), transition `duration-200`

## Nguyên tắc tổng thể khi áp dụng

1. **Bo góc nhiều, bo góc lớn** – tránh góc vuông sắc
2. **Khoảng trắng rộng rãi** – không bao giờ chật chội
3. **Tương phản qua màu nền**, không qua border
4. **Mỗi card là một "ô bento"** – có chức năng riêng, kích thước riêng, ghép thành tổng thể
5. **CTA quan trọng dùng dark pill** – contrast mạnh với phần còn lại
6. **Số liệu luôn nổi bật** – font lớn, weight nặng, đặt ở vị trí dễ nhìn
7. **Status/metadata dùng pill nhỏ có màu** – không dùng plain text

---

# Design Tokens & Component Library

Phần này định nghĩa chi tiết các design token và component states. Áp dụng nhất quán cho mọi UI element trong project. Visual style vẫn theo phong cách flat-modern đã định ở trên (không phải neumorphic), chỉ lấy **structure, states và spec** từ component reference.

## Design tokens

### Radius scale

Dùng nhất quán, không tự ý tạo giá trị mới.

| Token | Giá trị | Áp dụng |
|---|---|---|
| `radius-xs` | `4px` | Tag, badge nhỏ, inline element |
| `radius-sm` | `8px` | Input, button vuông, small card |
| `radius-md` | `12px` | Standard card, dropdown menu |
| `radius-lg` | `16px` | Large card, modal |
| `radius-xl` | `24px` | Hero card, main container |
| `radius-full` | `9999px` | Pill button, avatar, switch, badge round |

### Border thickness

| Token | Giá trị | Áp dụng |
|---|---|---|
| `border-thin` | `1px` | Default border, separator, table divider |
| `border-regular` | `2px` | Focus ring, active state, emphasized border |
| `border-thick` | `4px` | Accent strip, progress bar, tab indicator |

### Icon sizes

| Size | Áp dụng |
|---|---|
| `16px` | Inline icon trong text, badge, small button |
| `20px` | Standard UI icon (menu, action button) |
| `24px` | Large icon, primary action, hero icon |

**Stroke weight chuẩn**: `2px` cho tất cả line icon (Lucide style). Không mix nhiều stroke weight trong cùng giao diện.

### Elevation levels

5 cấp độ elevation (dùng shadow + z-index, không dùng neumorphic):

| Level | Áp dụng | Shadow |
|---|---|---|
| Level 1 (Flat) | Element nền, không nổi | `none` |
| Level 2 (Hover) | Card khi hover, button hover | `shadow-sm` |
| Level 3 (Raised) | Card chính, dropdown closed | `shadow-md` |
| Level 4 (Modal) | Modal, dialog, drawer | `shadow-xl` + backdrop |
| Level 5 (Popover) | Tooltip, popover, toast | `shadow-2xl` |

### Spacing tokens

Standard spacing giữa các nhóm element:

- Component nội bộ: `8px` / `12px` / `16px`
- Giữa các control trong group: `16px`
- Giữa các navigation element: `24px`
- Giữa các section lớn: `32px` / `48px`
- Feedback element (toast stack): `8px` gap

## Buttons

### Primary button

- Background: màu primary (theo project)
- Text: trắng, `font-medium`
- Padding: `px-5 py-2.5` (size default), `px-6 py-3` (size large)
- Radius: `radius-full` (pill) hoặc `radius-md` tùy context
- Icon optional: bên trái text, size 16-20px

### Button states

| State | Visual |
|---|---|
| Default | Background full, text trắng |
| Hover | Darken 5-10%, transition `duration-200` |
| Pressed/Active | Darken 15%, có thể kèm spinner nếu loading ("Sending...") |
| Disabled | Opacity `0.4`, `cursor-not-allowed`, không hover effect |
| Loading | Spinner icon + text thay đổi ("Submit Now" → "Sending...") |

### Secondary button

- Background: trong suốt hoặc xám rất nhạt
- Text: màu primary hoặc đen
- Border: `1px` xám nhạt (optional)

### Icon-only button

- Square hoặc tròn, kích thước cố định: `32px` / `40px` / `48px`
- Padding đều, icon centered
- Cùng states như button thường

## Form controls

### Text field

Cấu trúc đầy đủ: **Label → Input → Helper/Error text**

- **Default**: border `1px` xám nhạt, radius `radius-sm`, padding `px-3 py-2`, placeholder xám
- **Focus**: border màu primary `2px`, có thể kèm ring nhẹ
- **Filled**: text đen, border xám đậm hơn nhẹ
- **Error**: border đỏ `2px`, helper text đỏ ("Error: Invalid email format")
- **Disabled**: background xám nhạt, text xám, không tương tác
- **Helper text**: dưới input, `text-xs`, màu xám trung tính

### Checkbox

- Square `16-20px`, radius `radius-xs` (`4px`)
- **Unchecked**: border `1px` xám
- **Checked**: background primary, icon check trắng bên trong
- Label bên phải, `gap-2` với checkbox

### Radio

- Tròn hoàn toàn, kích thước `16-20px`
- **Unchecked**: border `1px` xám, rỗng
- **Checked**: border primary, có dot primary đặc ở giữa
- Group: stack dọc với `gap-3`

### Switch (toggle)

- Pill shape, width `36-44px`, height `20-24px`
- **Off**: background xám, thumb (tròn) ở trái
- **On**: background primary, thumb ở phải
- Có label "ON/OFF" bên cạnh (optional)
- Transition mượt khi đổi state, `duration-200`

### Slider

- Track: line mảnh `2-4px`, background xám
- Active track: từ đầu đến thumb, màu primary
- Thumb: tròn `16-20px`, background trắng với border primary hoặc full primary
- **Value tooltip**: pill đen phía trên thumb khi drag, hiển thị số (vd "75%")
- Scale markers bên dưới (optional): `0 / 25 / 50 / 75 / 100`

## Navigation

### Tabs

- Layout: ngang, gap `24px` giữa các tab
- **Inactive**: text xám, không có background
- **Active**: text đen, có **underline `2-3px`** màu primary bên dưới (hoặc background pill nhẹ)
- Hover: text đậm hơn, transition mượt

### Breadcrumbs

- Inline, separator: `/` xám hoặc icon `chevron-right`
- Mỗi level: text nhỏ (`text-sm`), màu xám
- Level cuối (current page): text đậm, màu đen, không click được
- Spacing: `px-2` giữa text và separator

### Stepper (multi-step process)

Hiển thị tiến trình nhiều bước (vd 4 steps: Account → Details → Review → Payment)

- Mỗi step: số trong vòng tròn + label bên dưới
- **Completed**: vòng tròn fill primary, có check icon trắng
- **Current**: vòng tròn fill primary, số trắng, có thể có **tooltip "Current Step: ..."** phía trên
- **Upcoming**: vòng tròn outline xám, số xám
- Connector line giữa các step: line mảnh, fill primary cho phần đã hoàn thành, xám cho phần chưa

### Pagination

- Layout ngang: `Prev` ← [1] [2] [3] [4] → `Next`
- Mỗi page number trong **box vuông bo góc** (`radius-sm`), kích thước cố định
- **Current page**: background primary, text trắng
- **Other pages**: background trong suốt, text đen, hover background xám nhạt
- Prev/Next: text only hoặc kèm icon, disabled khi ở đầu/cuối

## Data display

### Card (generic)

- Background trắng/nền nhạt, radius `radius-md` hoặc `radius-lg`
- Padding `p-4` đến `p-6`
- Có thể có thumbnail/icon ở top
- Title đậm + description xám + action button (vd "View More") ở bottom

### List item (with avatar)

- Layout ngang: **avatar tròn** + **text block** (title + subtitle)
- Padding `py-3`, separator mỏng giữa các item
- Hover: background xám rất nhạt
- Title `font-medium`, subtitle `text-sm` xám

### Badge

3 variants chính:

| Variant | Style |
|---|---|
| **Solid color** | Background đầy màu (primary/success/warning...), text trắng, `rounded-full`, `text-xs`, padding `px-2 py-0.5` |
| **Soft color** | Background tint nhạt của màu (vd `bg-green-50`), text đậm của màu (`text-green-700`) |
| **Number/Count** | Tròn hoàn toàn, kích thước nhỏ `min-w-5`, background primary, text trắng, dùng cho notification count |

### Avatar

- Tròn hoàn toàn (`rounded-full`)
- Kích thước: `24px` (xs), `32px` (sm), `40px` (md), `48px` (lg)
- **Avatar group**: stack chồng lên nhau với overlap khoảng 30%, có ring trắng `2px` xung quanh mỗi avatar để tách
- Fallback: initials (chữ cái đầu) trên background màu pastel

### Tooltip

- Background đen/dark, text trắng, `text-xs`
- Padding `px-2 py-1`, radius `radius-sm`
- Có **arrow** nhỏ trỏ về element trigger
- Xuất hiện sau delay `~500ms` hover
- Z-index cao, không bị che

### Compact table header

- Row header: background xám rất nhạt, text uppercase `text-xs` hoặc `text-sm font-medium`
- **Sort indicator**: icon mũi tên (↑↓) bên phải column name, click để sort
- **Filter icon**: bên phải cùng của header row
- Dropdown sort: pill style với chevron (vd "Name (A-Z) ▼")
- Column separator: rất mờ hoặc bỏ

## Feedback components

### Modal / Dialog

- Backdrop: đen với opacity `0.4-0.6`, blur nhẹ optional
- Modal container: trắng, radius `radius-lg`, padding `p-6`, max-width vừa phải (`400-500px`)
- Layout: **Icon/Illustration top** (optional) → **Title** → **Body text** → **Action buttons row**
- Action buttons: 2 buttons cạnh nhau, secondary (Cancel) bên trái, primary (Confirm/Delete) bên phải
- **Destructive action**: button màu đỏ thay vì primary (vd "Delete")
- Close icon (X) ở góc trên phải optional

### Toast

- Vị trí: bottom-right hoặc top-right
- Pill/card nhỏ, radius `radius-md`, padding `px-4 py-3`
- **Stack**: nhiều toast xếp dọc với `gap-2`
- Có icon trạng thái bên trái: ✓ success, ⓘ info, ⚠ warning, ✕ error
- Auto-dismiss sau `3-5s`, có thể có close button
- Slide-in animation từ cạnh màn hình

### Alert banner

- Layout ngang, full-width của container
- Background: tint nhạt theo loại (info/warning/error/success)
- Icon bên trái + message + close button bên phải (optional)
- Radius `radius-md`, padding `px-4 py-3`
- Text `text-sm`, đậm hơn cho keyword ("Important: ...")

### Progress bar (linear)

- Height `6-8px`, radius `radius-full`
- Track: xám nhạt, fill: primary
- Có thể có label `%` bên phải hoặc phía trên
- **Indeterminate**: animation shimmer chạy ngang

### Spinner

- Circular loader, size `16px` / `24px` / `32px`
- Stroke `2px`, màu primary
- Animation: rotate liên tục, `duration-1000`

### Skeleton

- Placeholder cho content đang load
- Background xám nhạt với **shimmer animation** (gradient chạy ngang)
- Shape match với content thật: row dài cho text, hình vuông cho avatar/image
- Radius nhỏ `radius-xs` hoặc `radius-sm`
- Stack nhiều row với gap đều

### Empty state

- Container có **dashed border** xám nhạt (optional), radius `radius-lg`, padding lớn (`p-8+`)
- **Icon/Illustration** lớn ở giữa, màu xám
- **Title**: "No Results Found" / "No data yet", `font-medium`
- **Subtitle** ngắn mô tả lý do (optional)
- **CTA button**: action chính (vd "Clear Filters", "Add New"), button primary nhỏ

## Component usage guidelines

1. **Nhất quán radius**: mỗi component giữ một radius cố định trong toàn hệ thống, không mix random
2. **States đầy đủ**: mọi interactive element phải có ít nhất default / hover / active / disabled
3. **Loading & empty states bắt buộc**: mọi data view phải handle 3 case: loading (skeleton), empty (empty state), error (alert)
4. **Feedback ngay lập tức**: mọi user action phải có visual feedback trong `200ms` (button press, toast, loading)
5. **Destructive actions cần confirm**: delete/remove luôn qua modal confirm với button đỏ
6. **Icon đồng bộ**: cùng size, cùng stroke weight, cùng style (chỉ dùng một icon set như Lucide)
7. **Accessibility**: focus ring rõ ràng, label cho input, alt text cho image, đủ contrast cho text
