-- =============================================================================
-- One-time backfill: dọn timezone của sales_orders + sales_payments đã bị
-- KiotViet sync với naive timestamps (giờ VN nhưng PG hiểu là UTC).
-- =============================================================================
--
-- BACKGROUND
-- ----------
-- KiotViet API trả purchaseDate / transDate / createdDate dạng naive string
-- ("2024-05-04T18:00:00", không có TZ marker), đại diện cho **giờ Việt Nam**.
-- Code transform.ts:132 (cũ) truyền nguyên string vào PG timestamptz. Supabase
-- session UTC → instant stored bằng "VN-time-as-UTC", lệch +7 giờ vs reality.
--
-- Hậu quả: queries filter theo `purchase_at <= now()` loại nhầm orders giờ
-- tối VN khỏi tổng POS (đã fix workaround trong commit 9b03276 — bỏ time
-- filter trong compute_cash_theory).
--
-- Forward-looking fix: src/lib/kiotviet/transform.ts thêm helper
-- parseKiotVietTimestamp wrap mọi naive timestamp với +07:00 offset trước
-- khi convert UTC ISO. Mọi sales_orders insert MỚI sau commit này đều correct.
--
-- File này backfill data CŨ (insert trước fix forward-looking).
--
-- =============================================================================
-- ⚠️  CHẠY 1 LẦN DUY NHẤT  ⚠️
-- =============================================================================
-- Script không idempotent! Re-run sẽ shift tiếp -7h → data CÀNG SAI.
-- Nếu lỡ chạy 2 lần, dừng lại + restore từ Supabase backup.
--
-- Khuyến nghị:
-- 1. Backup DB trước khi chạy (Supabase Dashboard → Database → Backups).
-- 2. Run "Step 0 — diagnostic" để confirm hypothesis trước.
-- 3. Run backfill trong transaction (đã wrap BEGIN/COMMIT).
-- 4. Run "Step 4 — verify" sau khi commit.
-- =============================================================================


-- ====== Step 0 — Diagnostic (READ-ONLY, chạy trước backfill) =================

-- Q1: Max purchase_at có "ở tương lai" so với now() không?
-- Nếu data sai TZ, max(purchase_at) thường > now() vì giờ VN luôn > giờ UTC.
select
  count(*) as total_orders,
  min(purchase_at) as earliest_purchase,
  max(purchase_at) as latest_purchase,
  now() as server_now_utc,
  now() at time zone 'Asia/Ho_Chi_Minh' as server_now_vn,
  case
    when max(purchase_at) > now() then 'LIKELY TZ-SHIFTED (data bị lệch)'
    else 'OK hoặc đã fix'
  end as diagnosis
from public.sales_orders;

-- Q2: Có row nào purchase_at "ở tương lai" theo expected business hours?
-- Coffee shop thường đóng cửa <= 23h VN. Nếu có row >= 17:00 UTC (= 24:00 VN)
-- thì dữ liệu đó bị shift.
select
  business_date,
  purchase_at,
  (purchase_at at time zone 'Asia/Ho_Chi_Minh') as wall_clock_vn,
  net_amount
from public.sales_orders
where extract(hour from purchase_at) >= 17  -- = 24h VN
order by purchase_at desc
limit 10;


-- ====== Step 1 — Backfill sales_orders (run trong transaction) ===============

begin;

-- Shift purchase_at -7h: stored value coi như VN local, trừ 7h thành UTC thật.
update public.sales_orders
set purchase_at = purchase_at - interval '7 hours';

-- Cập nhật business_date theo wall-clock VN của purchase_at đã sửa.
-- Hầu hết rows business_date đã đúng (vì JS Date parse naive như UTC trên
-- server UTC → date extract giống VN local date), nhưng để chắc chắn nhất
-- quán, recompute từ corrected purchase_at.
update public.sales_orders
set business_date = (purchase_at at time zone 'Asia/Ho_Chi_Minh')::date
where business_date <> (purchase_at at time zone 'Asia/Ho_Chi_Minh')::date;

-- Step 2 — Backfill sales_payments (cùng shift -7h)
update public.sales_payments
set payment_time = payment_time - interval '7 hours'
where payment_time is not null;

-- Step 3 — Backfill source_created_at trong sales_orders (cũng từ KiotViet)
update public.sales_orders
set source_created_at = source_created_at - interval '7 hours'
where source_created_at is not null;

commit;


-- ====== Step 4 — Verify post-backfill (READ-ONLY) ============================

-- V1: Max purchase_at giờ phải <= now()
select
  count(*) as total_orders,
  max(purchase_at) as latest_purchase,
  now() as server_now_utc,
  case
    when max(purchase_at) > now() + interval '5 minutes' then '❌ Vẫn còn future timestamps'
    else '✅ Tất cả purchase_at <= now()'
  end as verification
from public.sales_orders;

-- V2: business_date giờ phải khớp với wall-clock VN của purchase_at
select
  count(*) as mismatched_rows
from public.sales_orders
where business_date <> (purchase_at at time zone 'Asia/Ho_Chi_Minh')::date;
-- Expected: 0

-- V3: hourly distribution check — sales nên tập trung 6h-23h VN, không có
-- sales 0h-5h VN bất thường.
select
  extract(hour from (purchase_at at time zone 'Asia/Ho_Chi_Minh')) as hour_vn,
  count(*) as orders,
  sum(net_amount) as revenue
from public.sales_orders
where business_date >= current_date - interval '7 days'
group by 1
order by 1;
