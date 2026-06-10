-- 075 — safe_fund_balance_now / safe_balances_now (Phase 1 — Sổ quỹ 2 quỹ).
-- Số dư mỗi quỹ = balance_after của row GHI gần nhất (created_at desc, id desc)
-- của quỹ đó. Pollution-independent: row future-dated áp đảo dữ liệu hiện có;
-- BEGIN/ROLLBACK nên không để lại gì.
BEGIN;
SELECT plan(4);

-- Seed trực tiếp (superuser → bypass RLS). created_at tương lai để chắc chắn là "mới nhất".
INSERT INTO public.safe_transactions (transaction_type, amount, balance_after, fund, created_at, description) VALUES
  ('initial_setup', 100000, 100000, 'cash',     now() + interval '1 hour',     '075 cash older'),
  ('adjustment',     50000, 150000, 'cash',     now() + interval '2 hours',    '075 cash latest'),
  ('initial_setup',  80000,  80000, 'transfer', now() + interval '90 minutes', '075 transfer');

SELECT is(public.safe_fund_balance_now('cash'), 150000::numeric,
  'cash = balance_after của row cash ghi gần nhất');
SELECT is(public.safe_fund_balance_now('transfer'), 80000::numeric,
  'transfer = row transfer ghi gần nhất');
SELECT is((public.safe_balances_now()->>'total')::numeric, 230000::numeric,
  'total = cash + transfer');

-- Tie-break: cùng created_at → id lớn hơn thắng.
INSERT INTO public.safe_transactions (id, transaction_type, amount, balance_after, fund, created_at, description) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'adjustment', 1, 111111, 'cash', now() + interval '3 hours', '075 tie a'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'adjustment', 1, 222222, 'cash', now() + interval '3 hours', '075 tie f');

SELECT is(public.safe_fund_balance_now('cash'), 222222::numeric,
  'tie-break created_at bằng nhau → id lớn hơn thắng');

SELECT * FROM finish();
ROLLBACK;
