-- =============================================================================
-- Manual KiotViet Excel import — fix drifted invoice dates (2026-05-29)
--
-- Owner-only RPC that re-imports sales from a KiotViet "Chi tiết hóa đơn" export.
-- Matches existing orders by **invoice_code** (the Excel only carries the human
-- "HD..." code, not the API's internal kiotviet_invoice_id), then UPSERTS:
--   * existing (by invoice_code) → UPDATE date/amounts + re-create items/payments
--   * missing                    → INSERT (synthetic kiotviet_invoice_id 'excel:'||code)
--
-- p_commit = false → DRY-RUN: counts + date_corrections sample, writes nothing.
-- p_commit = true  → applies + audit row in sales_sync_runs (source='excel_import').
--
-- Item/payment/cash_drawer blocks mirror ingest_kiotviet_batch (002_functions.sql).
-- Idempotent: create or replace + partial unique index guards backfill dupes.
-- =============================================================================

-- Hardening: one row per invoice_code (safe — codes are unique in practice).
-- Prevents a backfilled 'excel:'||code row from later duplicating an API-synced
-- row that shares the same invoice_code.
create unique index if not exists sales_orders_invoice_code_uidx
  on public.sales_orders(invoice_code) where invoice_code is not null;

create or replace function public.import_sales_from_excel(
  p_payload jsonb,
  p_commit  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_order jsonb;
  v_item jsonb;
  v_payment jsonb;
  v_order_id uuid;
  v_payment_id uuid;
  v_existing_id uuid;
  v_old_bdate date;
  v_new_bdate date;
  v_code text;
  v_run_id uuid;
  v_batch text := coalesce(nullif(p_payload->>'batch_id',''), 'excel-' || gen_random_uuid()::text);
  v_idx integer;
  v_would_update integer := 0;
  v_would_insert integer := 0;
  v_orders integer := 0;
  v_items integer := 0;
  v_payments integer := 0;
  v_corrections jsonb := '[]'::jsonb;
  v_payment_method text;
  v_payment_amount numeric(14,2);
  v_cash_received numeric(14,2);
  v_change_given numeric(14,2);
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_net numeric(14,2);
  v_total_payment numeric(14,2);
  v_qty numeric;
  v_price numeric;
  v_item_disc numeric;
  v_line_total numeric;
  v_max_amount constant numeric := 1000000000;
  v_max_qty constant numeric := 9999;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được import Excel.';
  end if;

  -- Audit row only when committing.
  if p_commit then
    insert into public.sales_sync_runs (batch_id, source, status, started_at, raw_json)
    values (v_batch, 'excel_import', 'running', now(), p_payload)
    on conflict (batch_id) do update set status = 'running', started_at = excluded.started_at, raw_json = excluded.raw_json
    returning id into v_run_id;
  end if;

  for v_order in select * from jsonb_array_elements(coalesce(p_payload->'orders','[]'::jsonb)) loop
    v_code := nullif(v_order->>'invoice_code','');
    if v_code is null then
      raise exception 'import_sales_from_excel: thiếu invoice_code';
    end if;

    v_gross := coalesce(nullif(v_order->>'gross_amount','')::numeric, 0);
    v_discount := coalesce(nullif(v_order->>'discount_amount','')::numeric, 0);
    v_net := coalesce(nullif(v_order->>'net_amount','')::numeric, coalesce(nullif(v_order->>'total_payment','')::numeric, 0));
    v_total_payment := coalesce(nullif(v_order->>'total_payment','')::numeric, v_net);
    if v_gross < 0 or v_discount < 0 or v_net < 0 or v_total_payment < 0 then
      raise exception 'import_sales_from_excel: số tiền âm tại order=%', v_code;
    end if;
    if v_gross > v_max_amount or v_net > v_max_amount or v_total_payment > v_max_amount then
      raise exception 'import_sales_from_excel: số tiền vượt ngưỡng (>%) tại order=%', v_max_amount, v_code;
    end if;

    v_new_bdate := coalesce(
      nullif(v_order->>'business_date','')::date,
      (nullif(v_order->>'purchase_at','')::timestamptz)::date
    );

    select id, business_date into v_existing_id, v_old_bdate
      from public.sales_orders where invoice_code = v_code order by created_at limit 1;

    -- Tally (both dry-run and commit) + sample date corrections (cap 50).
    if v_existing_id is not null then
      v_would_update := v_would_update + 1;
      if v_old_bdate is distinct from v_new_bdate and jsonb_array_length(v_corrections) < 50 then
        v_corrections := v_corrections || jsonb_build_object('invoice_code', v_code, 'from', v_old_bdate, 'to', v_new_bdate);
      end if;
    else
      v_would_insert := v_would_insert + 1;
      if jsonb_array_length(v_corrections) < 50 then
        v_corrections := v_corrections || jsonb_build_object('invoice_code', v_code, 'from', null, 'to', v_new_bdate);
      end if;
    end if;

    if not p_commit then
      continue;  -- DRY-RUN: no writes
    end if;

    if v_existing_id is not null then
      update public.sales_orders set
        purchase_at = coalesce(nullif(v_order->>'purchase_at','')::timestamptz, purchase_at),
        business_date = v_new_bdate,
        gross_amount = v_gross,
        discount_amount = v_discount,
        net_amount = v_net,
        total_payment = v_total_payment,
        branch_name = coalesce(v_order->>'branch_name', branch_name),
        sold_by_name = coalesce(v_order->>'sold_by_name', sold_by_name),
        customer_name = coalesce(v_order->>'customer_name', customer_name),
        status_value = coalesce(v_order->>'status_value', status_value),
        sync_run_id = v_run_id,
        raw_json = v_order,
        updated_at = now()
      where id = v_existing_id
      returning id into v_order_id;
    else
      insert into public.sales_orders (
        kiotviet_invoice_id, invoice_code, table_or_order_code, purchase_at, business_date,
        branch_name, sold_by_name, customer_name,
        gross_amount, discount_amount, net_amount, total_payment, status_value, sync_run_id, raw_json
      ) values (
        'excel:' || v_code,
        v_code,
        nullif(v_order->>'table_or_order_code',''),
        coalesce(nullif(v_order->>'purchase_at','')::timestamptz, now()),
        v_new_bdate,
        v_order->>'branch_name',
        v_order->>'sold_by_name',
        v_order->>'customer_name',
        v_gross, v_discount, v_net, v_total_payment,
        v_order->>'status_value', v_run_id, v_order
      )
      returning id into v_order_id;
    end if;

    -- Re-create children (mirror ingest_kiotviet_batch).
    delete from public.sales_order_items where sales_order_id = v_order_id;
    delete from public.cash_drawer_events where sales_order_id = v_order_id and source = 'pos_sync';
    delete from public.sales_payments where sales_order_id = v_order_id;

    v_idx := 0;
    for v_item in select * from jsonb_array_elements(coalesce(v_order->'invoice_details', v_order->'items', '[]'::jsonb)) loop
      v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
      v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, 0);
      v_item_disc := coalesce(nullif(v_item->>'discount_amount','')::numeric, 0);
      v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, v_qty * v_price);
      if v_qty < 0 or v_price < 0 or v_item_disc < 0 or v_line_total < 0 then
        raise exception 'import_sales_from_excel: numeric âm tại order=% item=%', v_code, v_idx;
      end if;
      if v_qty > v_max_qty or v_price > v_max_amount or v_line_total > v_max_amount then
        raise exception 'import_sales_from_excel: vượt ngưỡng tại order=% item=%', v_code, v_idx;
      end if;

      insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, quantity, unit_price, discount_amount, discount_ratio, line_total, note, return_quantity, category_name, raw_json)
      values (
        v_order_id,
        v_idx,
        coalesce(nullif(v_item->>'item_key',''), nullif(v_item->>'id',''), coalesce(v_item->>'product_code','product') || '-' || v_idx::text),
        nullif(v_item->>'product_id',''),
        nullif(v_item->>'product_code',''),
        coalesce(v_item->>'product_name', v_item->>'name', 'Sản phẩm'),
        v_qty, v_price, v_item_disc,
        coalesce(nullif(v_item->>'discount_ratio','')::numeric, 0),
        v_line_total,
        v_item->>'note',
        coalesce(nullif(v_item->>'return_quantity','')::numeric, 0),
        v_item->>'category_name',
        v_item
      );
      v_idx := v_idx + 1;
      v_items := v_items + 1;
    end loop;

    for v_payment in select * from jsonb_array_elements(coalesce(v_order->'payments', jsonb_build_array(jsonb_build_object('payment_method', 'unknown', 'amount', coalesce(v_order->>'total_payment', v_order->>'net_amount'))))) loop
      v_payment_method := lower(coalesce(v_payment->>'payment_method', v_payment->>'method', 'unknown'));
      v_payment_amount := coalesce(nullif(v_payment->>'amount','')::numeric, 0);
      v_cash_received := nullif(v_payment->>'cash_received','')::numeric;
      v_change_given := nullif(v_payment->>'change_given','')::numeric;
      if v_payment_amount < 0 or coalesce(v_cash_received, 0) < 0 or coalesce(v_change_given, 0) < 0 then
        raise exception 'import_sales_from_excel: payment âm tại order=%', v_code;
      end if;
      if v_payment_amount > v_max_amount or coalesce(v_cash_received, 0) > v_max_amount or coalesce(v_change_given, 0) > v_max_amount then
        raise exception 'import_sales_from_excel: payment vượt ngưỡng tại order=%', v_code;
      end if;
      if v_payment_method = 'cash' and v_cash_received is not null and v_cash_received < v_payment_amount then
        raise exception 'import_sales_from_excel: cash_received (%) < amount (%) tại order=%', v_cash_received, v_payment_amount, v_code;
      end if;

      insert into public.sales_payments (sales_order_id, payment_method, amount, cash_received, change_given, payment_time, source, confidence, raw_json)
      values (v_order_id, v_payment_method, v_payment_amount, v_cash_received, v_change_given, coalesce(nullif(v_payment->>'payment_time','')::timestamptz, (v_order->>'purchase_at')::timestamptz, now()), coalesce(v_payment->>'source','kiotviet'), coalesce(v_payment->>'confidence', case when v_payment ? 'amount' then 'exact' else 'derived' end), v_payment)
      returning id into v_payment_id;

      if v_payment_method = 'cash' then
        if v_cash_received is not null and v_change_given is not null then
          insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
          select business_date, purchase_at, 'customer_cash_received', 'in', v_cash_received, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
          if v_change_given > 0 then
            insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
            select business_date, purchase_at, 'change_given', 'out', v_change_given, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
          end if;
        else
          insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
          select business_date, purchase_at, 'pos_cash_in', 'in', v_payment_amount, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
        end if;
      end if;
      v_payments := v_payments + 1;
    end loop;

    v_orders := v_orders + 1;
  end loop;

  if p_commit then
    update public.sales_sync_runs set status = 'success', finished_at = now(), order_count = v_orders, item_count = v_items, payment_count = v_payments where id = v_run_id;
  end if;

  return jsonb_build_object(
    'committed', p_commit,
    'would_update', v_would_update,
    'would_insert', v_would_insert,
    'date_corrections', v_corrections,
    'orders', v_orders,
    'items', v_items,
    'payments', v_payments,
    'run_id', v_run_id,
    'status', 'success'
  );
end;
$$;

revoke all on function public.import_sales_from_excel(jsonb, boolean) from public;
grant execute on function public.import_sales_from_excel(jsonb, boolean) to authenticated;

comment on function public.import_sales_from_excel(jsonb, boolean) is
  'Owner-only manual KiotViet Excel re-import keyed on invoice_code (fix drifted dates). p_commit=false = dry-run.';

notify pgrst, 'reload schema';
