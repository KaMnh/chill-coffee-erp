-- get_cash_close_reports_by_period RPC tests.
--
-- 10 assertions:
--   1. Đúng khoảng: loại ngày ngoài [from,to] (4/5 report trả về)
--   2. Sort business_date DESC: phần tử [0] = ngày mới nhất
--   3. Cùng ngày sort closed_at DESC: 03-02 final (closed muộn hơn) đứng trước voided
--   4. Cùng ngày: phần tử kế là voided (closed sớm hơn)
--   5. Phần tử cuối = ngày cũ nhất trong khoảng
--   6. Gồm cả voided (đúng 1 voided trong kết quả)
--   7. Ngày ngoài khoảng bị loại (không có business_date 2026-02-25)
--   8. Nạp két per-day đọc đúng safe_deposit_amount
--   9. Nạp két per-day đọc đúng bank_transfer_confirmed
--  10. Khoảng rỗng → '[]'::jsonb

BEGIN;
SELECT plan(10);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
END;
$$ LANGUAGE plpgsql;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- cash_counts (1 per report; chỉ business_date là bắt buộc)
INSERT INTO public.cash_counts (id, business_date) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001', '2026-03-01'),
  ('aaaaaaa1-0000-0000-0000-000000000002', '2026-03-02'),
  ('aaaaaaa1-0000-0000-0000-000000000003', '2026-03-02'),
  ('aaaaaaa1-0000-0000-0000-000000000004', '2026-03-05'),
  ('aaaaaaa1-0000-0000-0000-000000000005', '2026-02-25');

-- cash_close_reports — closed_at LỆCH NHAU để tie-break xác định
INSERT INTO public.cash_close_reports
  (id, business_date, cash_count_id, closed_at, report_status, safe_deposit_amount, bank_transfer_confirmed, difference)
VALUES
  ('bbbbbbb1-0000-0000-0000-000000000001', '2026-03-01', 'aaaaaaa1-0000-0000-0000-000000000001', '2026-03-01 20:00:00+07', 'final',  100000, 50000, 0),
  ('bbbbbbb1-0000-0000-0000-000000000002', '2026-03-02', 'aaaaaaa1-0000-0000-0000-000000000002', '2026-03-02 21:00:00+07', 'voided', 0,      0,     0),
  ('bbbbbbb1-0000-0000-0000-000000000003', '2026-03-02', 'aaaaaaa1-0000-0000-0000-000000000003', '2026-03-02 22:00:00+07', 'final',  200000, 0,     0),
  ('bbbbbbb1-0000-0000-0000-000000000004', '2026-03-05', 'aaaaaaa1-0000-0000-0000-000000000004', '2026-03-05 20:00:00+07', 'final',  300000, 0,     0),
  ('bbbbbbb1-0000-0000-0000-000000000005', '2026-02-25', 'aaaaaaa1-0000-0000-0000-000000000005', '2026-02-25 20:00:00+07', 'final',  999999, 0,     0);

-- ACT
CREATE TEMP TABLE _res AS
SELECT public.get_cash_close_reports_by_period('2026-03-01', '2026-03-05') AS j;

CREATE TEMP TABLE _empty AS
SELECT public.get_cash_close_reports_by_period('2026-01-01', '2026-01-02') AS j;

-- 1: đúng khoảng → 4 phần tử (loại 2026-02-25)
SELECT is(
  (SELECT jsonb_array_length(j) FROM _res),
  4,
  'returns 4 reports inside [from,to], excludes out-of-range'
);

-- 2: business_date DESC → [0] = 2026-03-05
SELECT is(
  (SELECT j->0->>'business_date' FROM _res),
  '2026-03-05',
  'sorted business_date DESC: newest first'
);

-- 3: cùng 2026-03-02, closed_at DESC → final (22:00) đứng trước
SELECT is(
  (SELECT j->1->>'report_status' FROM _res),
  'final',
  'same business_date: later closed_at (final) comes first'
);

-- 4: kế tiếp là voided (21:00)
SELECT is(
  (SELECT j->2->>'report_status' FROM _res),
  'voided',
  'same business_date: earlier closed_at (voided) comes second'
);

-- 5: phần tử cuối = ngày cũ nhất trong khoảng
SELECT is(
  (SELECT j->3->>'business_date' FROM _res),
  '2026-03-01',
  'oldest in-range date is last'
);

-- 6: gồm cả voided — đúng 1 voided
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'report_status' = 'voided'),
  1,
  'voided reports are included'
);

-- 7: out-of-range bị loại
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'business_date' = '2026-02-25'),
  0,
  'out-of-range date excluded'
);

-- 8: nạp két per-day đọc đúng safe_deposit_amount (report 2026-03-01)
SELECT is(
  (SELECT (e->>'safe_deposit_amount')::numeric
   FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'id' = 'bbbbbbb1-0000-0000-0000-000000000001'),
  100000::numeric,
  'safe_deposit_amount surfaced per report'
);

-- 9: nạp két per-day đọc đúng bank_transfer_confirmed
SELECT is(
  (SELECT (e->>'bank_transfer_confirmed')::numeric
   FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'id' = 'bbbbbbb1-0000-0000-0000-000000000001'),
  50000::numeric,
  'bank_transfer_confirmed surfaced per report'
);

-- 10: khoảng rỗng → '[]'
SELECT is(
  (SELECT jsonb_array_length(j) FROM _empty),
  0,
  'empty range returns []'
);

SELECT * FROM finish();
ROLLBACK;
