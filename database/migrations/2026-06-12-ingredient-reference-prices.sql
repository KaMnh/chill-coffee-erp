-- =============================================================================
-- Migration: ingredient_reference_prices — đơn giá tham chiếu tồn kho,
-- owner đặt tay, CHỈ owner đọc/ghi (RLS như safe_transactions).
-- Spec: docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md
-- =============================================================================

create table if not exists public.ingredient_reference_prices (
  ingredient_id uuid primary key
    references public.ingredients(id) on delete cascade,
  unit_price bigint not null check (unit_price >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ingredient_reference_prices enable row level security;

drop policy if exists ingredient_ref_prices_owner_all on public.ingredient_reference_prices;
create policy ingredient_ref_prices_owner_all on public.ingredient_reference_prices
  for all to authenticated
  using (public.app_role() = 'owner')
  with check (public.app_role() = 'owner');

grant select, insert, update, delete
  on public.ingredient_reference_prices to authenticated;
grant all on public.ingredient_reference_prices to service_role;
