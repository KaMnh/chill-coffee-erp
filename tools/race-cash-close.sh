#!/usr/bin/env bash
# tools/race-cash-close.sh — Manual 2-session regression: drive the REAL RPCs to
# prove the cash_close:<date> advisory lock serializes finalize vs the payroll/opening/
# cash-count write paths. NOT run in CI (pgTAP is single-session). Best-effort, timing-based.
#
# Runs against the Supabase docker `db` (same pattern as scripts/pgtap-run.mjs).
# Seeds COMMITTED fixtures on far-future dates, runs the interleavings, asserts, cleans up.
#
# Usage: bash tools/race-cash-close.sh
set -uo pipefail
PW="$(grep '^POSTGRES_PASSWORD=' supabase/.env | cut -d= -f2)"
OWNER='ad000000-0000-0000-0000-0000000000ff'
EMP='ed000000-0000-0000-0000-0000000000ff'
# D1..D4 are computed below (after psql() is defined) as current_date+5..8 — a few days
# out so they don't collide with real data, yet stay inside compute_cash_theory's window
# [business_date-7d, now()+5min] when counted_at = now()+4min.
#   D1 = writer-first PAYROLL; D2 = finalize-first PAYROLL;
#   D3 = writer-first UPDATE_CASH_COUNT (count row read live by finalize);
#   D4 = finalize-first OPENING (opening can only prove block+raise).
CLAIMS='{"sub":"'"$OWNER"'","role":"authenticated"}'
HOLD=4            # seconds session A holds the lock
MINWAIT=3.0       # session B must block at least this long

psql() { docker compose exec -T -e PGPASSWORD="$PW" db \
  psql -U postgres -d postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 -At "$@"; }
# psql that sets the owner JWT for the whole session (RPCs read auth.uid()).
psql_owner_sql() { docker compose exec -T -e PGPASSWORD="$PW" db \
  psql -U postgres -d postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 -At -c \
  "select set_config('request.jwt.claims','$CLAIMS',false);" -c "$1"; }

read D1 D2 D3 D4 <<< "$(psql -c "select (current_date+5)::text||' '||(current_date+6)::text||' '||(current_date+7)::text||' '||(current_date+8)::text;")"
echo "test dates: $D1 $D2 $D3 $D4 (counted_at = now()+4min)"

DATES="'$D1','$D2','$D3','$D4'"
cleanup() {
  psql -c "delete from public.cash_close_reports where business_date in ($DATES);
           delete from public.cash_drawer_events where business_date in ($DATES);
           delete from public.shift_payroll_records where business_date in ($DATES);
           delete from public.shift_assignments where business_date in ($DATES);
           delete from public.cash_counts where business_date in ($DATES);
           delete from public.cash_day_openings where business_date in ($DATES);
           delete from public.employee_accounts where auth_user_id='$OWNER';
           delete from public.employees where id='$EMP';
           delete from auth.users where id='$OWNER';" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup   # clear any leftovers from a prior aborted run
FAIL=0

# Preflight: the inclusion assertion relies on shift_payroll_records.payment_method
# defaulting to 'cash' (compute_cash_theory filters payment_method='cash').
DEF=$(psql -c "select column_default from information_schema.columns where table_name='shift_payroll_records' and column_name='payment_method';")
echo "payment_method default: ${DEF:-<none>}"
case "$DEF" in *cash*) ;; *) echo "WARN: payment_method default is not 'cash' — adapt the seed to set it, else inclusion check is weak.";; esac

echo "== Seed fixtures =="
psql <<SQL
insert into auth.users (id,email,encrypted_password,email_confirmed_at,instance_id)
  values ('$OWNER','race-owner@local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employee_accounts (auth_user_id,role,status) values ('$OWNER','owner','active');
insert into public.employees (id,name,hourly_rate) values ('$EMP','Race NV',60000);
select set_config('request.jwt.claims','$CLAIMS',false);
select public.save_cash_day_opening(jsonb_build_object('business_date','$D1','denominations_json',jsonb_build_object('100000',2)));
select public.save_cash_day_opening(jsonb_build_object('business_date','$D2','denominations_json',jsonb_build_object('100000',2)));
select public.save_cash_day_opening(jsonb_build_object('business_date','$D3','denominations_json',jsonb_build_object('100000',2)));
select public.save_cash_day_opening(jsonb_build_object('business_date','$D4','denominations_json',jsonb_build_object('100000',2)));
insert into public.shift_assignments (id,employee_id,business_date,check_in_at,status,created_by,updated_by)
  values ('5d000000-0000-0000-0000-0000000000d1','$EMP','$D1','$D1 09:00+07','checked_in','$OWNER','$OWNER'),
         ('5d000000-0000-0000-0000-0000000000d2','$EMP','$D2','$D2 09:00+07','checked_in','$OWNER','$OWNER');
select public.save_cash_count(jsonb_build_object('business_date','$D1','counted_at',(now()+interval '4 minutes')::text,'denominations_json',jsonb_build_object('100000',10),
  'total_physical',1000000,'bank_transfer_confirmed',0,'count_type','shift_close','pos_total',0,'pos_cash_total',0,'pos_non_cash_total',0));
select public.save_cash_count(jsonb_build_object('business_date','$D2','counted_at',(now()+interval '4 minutes')::text,'denominations_json',jsonb_build_object('100000',10),
  'total_physical',1000000,'bank_transfer_confirmed',0,'count_type','shift_close','pos_total',0,'pos_cash_total',0,'pos_non_cash_total',0));
select public.save_cash_count(jsonb_build_object('business_date','$D3','counted_at',(now()+interval '4 minutes')::text,'denominations_json',jsonb_build_object('100000',10),
  'total_physical',1000000,'bank_transfer_confirmed',0,'count_type','shift_close','pos_total',0,'pos_cash_total',0,'pos_non_cash_total',0));
select public.save_cash_count(jsonb_build_object('business_date','$D4','counted_at',(now()+interval '4 minutes')::text,'denominations_json',jsonb_build_object('100000',10),
  'total_physical',1000000,'bank_transfer_confirmed',0,'count_type','shift_close','pos_total',0,'pos_cash_total',0,'pos_non_cash_total',0));
-- counted_at = now()+4min stays inside compute_cash_theory's allowed window (<= now()+5min)
-- AND is after the writes this test makes, so they satisfy created_at <= counted_at.
SQL
CC1=$(psql -c "select id from public.cash_counts where business_date='$D1' and count_type='shift_close' limit 1;")
CC2=$(psql -c "select id from public.cash_counts where business_date='$D2' and count_type='shift_close' limit 1;")
CC3=$(psql -c "select id from public.cash_counts where business_date='$D3' and count_type='shift_close' limit 1;")
CC4=$(psql -c "select id from public.cash_counts where business_date='$D4' and count_type='shift_close' limit 1;")

# ---------- Scenario 1: writer-first → finalize WAITS, then includes the payroll ----------
echo "== Scenario 1: check_out_employee holds lock; finalize must wait =="
( docker compose exec -T -e PGPASSWORD="$PW" db psql -U postgres -d postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 -At <<SQL
begin;
select set_config('request.jwt.claims','$CLAIMS',false);
select public.check_out_employee(json_build_object('shift_assignment_id','5d000000-0000-0000-0000-0000000000d1',
  'employee_id','$EMP','business_date','$D1','check_in_at','$D1 09:00+07','check_out_at','$D1 17:00+07')::jsonb);
select pg_sleep($HOLD);
commit;
SQL
) &
APID=$!
sleep 1
START=$(date +%s.%N)
psql_owner_sql "select public.finalize_cash_close_report('$CC1'::uuid, 0);" >/dev/null
END=$(date +%s.%N)
wait "$APID" || true
WAIT1=$(echo "$END - $START" | bc)
PAY1=$(psql -c "select coalesce(payroll_cash_total,0) from public.cash_close_reports where business_date='$D1';")
awk "BEGIN{exit !($WAIT1 >= $MINWAIT)}" \
  && echo "  PASS finalize blocked ${WAIT1}s (>= ${MINWAIT}s)" \
  || { echo "  FAIL finalize did not block (${WAIT1}s) — lock missing/late in finalize or checkout"; FAIL=1; }
# 8h * 60000 = 480000 expected if payment_method='cash'
[ "${PAY1%.*}" = "480000" ] \
  && echo "  PASS finalized payroll_cash_total=$PAY1 (payroll included after waiting)" \
  || { echo "  FAIL finalized payroll_cash_total=$PAY1 (expected 480000) — snapshot missed the payroll"; FAIL=1; }

# ---------- Scenario 2: finalize-first → checkout WAITS, then RAISES (guard) ----------
echo "== Scenario 2: finalize holds lock; check_out_employee must wait then raise =="
( docker compose exec -T -e PGPASSWORD="$PW" db psql -U postgres -d postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 -At <<SQL
begin;
select set_config('request.jwt.claims','$CLAIMS',false);
select public.finalize_cash_close_report('$CC2'::uuid, 0);
select pg_sleep($HOLD);
commit;
SQL
) &
APID=$!
sleep 1
START=$(date +%s.%N)
ERR=$(docker compose exec -T -e PGPASSWORD="$PW" db psql -U postgres -d postgres -h 127.0.0.1 -At -c \
  "select set_config('request.jwt.claims','$CLAIMS',false);" -c \
  "select public.check_out_employee(json_build_object('shift_assignment_id','5d000000-0000-0000-0000-0000000000d2','employee_id','$EMP','business_date','$D2','check_in_at','$D2 09:00+07','check_out_at','$D2 17:00+07')::jsonb);" 2>&1 || true)
END=$(date +%s.%N)
wait "$APID" || true
WAIT2=$(echo "$END - $START" | bc)
awk "BEGIN{exit !($WAIT2 >= $MINWAIT)}" \
  && echo "  PASS checkout blocked ${WAIT2}s (>= ${MINWAIT}s)" \
  || { echo "  FAIL checkout did not block (${WAIT2}s)"; FAIL=1; }
echo "$ERR" | grep -q 'đã chốt két' \
  && echo "  PASS checkout raised guard after waiting" \
  || { echo "  FAIL checkout did not raise the final-close guard. Got: $ERR"; FAIL=1; }

# ---------- Scenario 3: update_cash_count holds lock; finalize WAITS, reads the UPDATED count ----------
# This is the real "inclusion" proof for the count row: finalize reads physical_cash
# from v_count LIVE, so the updated total_physical must appear in the final report.
echo "== Scenario 3: update_cash_count holds lock; finalize must wait + read new physical_cash =="
( docker compose exec -T -e PGPASSWORD="$PW" db psql -U postgres -d postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 -At <<SQL
begin;
select set_config('request.jwt.claims','$CLAIMS',false);
select public.update_cash_count(json_build_object('id','$CC3','denominations_json',json_build_object('100000',15))::jsonb);
select pg_sleep($HOLD);
commit;
SQL
) &
APID=$!
sleep 1
START=$(date +%s.%N)
psql_owner_sql "select public.finalize_cash_close_report('$CC3'::uuid, 0);" >/dev/null
END=$(date +%s.%N)
wait "$APID" || true
WAIT3=$(echo "$END - $START" | bc)
PHYS3=$(psql -c "select coalesce(physical_cash,0) from public.cash_close_reports where business_date='$D3';")
awk "BEGIN{exit !($WAIT3 >= $MINWAIT)}" \
  && echo "  PASS finalize blocked ${WAIT3}s (>= ${MINWAIT}s)" \
  || { echo "  FAIL finalize did not block (${WAIT3}s) — lock missing/late in finalize or update_cash_count"; FAIL=1; }
# 15 * 100000 = 1500000 — finalize must read the UPDATED count's physical_cash
[ "${PHYS3%.*}" = "1500000" ] \
  && echo "  PASS finalized physical_cash=$PHYS3 (read the updated count after waiting)" \
  || { echo "  FAIL finalized physical_cash=$PHYS3 (expected 1500000) — snapshot read a stale count"; FAIL=1; }

# ---------- Scenario 4: finalize-first → save_cash_day_opening WAITS, then RAISES (guard) ----------
# Opening cannot prove "inclusion": finalize FREEZES opening_cash from the count via
# coalesce(nullif(v_count.opening_cash,0),...), so a live opening edit is not picked up.
# Opening's demonstrable cross-session property is therefore block + guard-raise only.
echo "== Scenario 4: finalize holds lock; save_cash_day_opening must wait then raise =="
( docker compose exec -T -e PGPASSWORD="$PW" db psql -U postgres -d postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 -At <<SQL
begin;
select set_config('request.jwt.claims','$CLAIMS',false);
select public.finalize_cash_close_report('$CC4'::uuid, 0);
select pg_sleep($HOLD);
commit;
SQL
) &
APID=$!
sleep 1
START=$(date +%s.%N)
ERR4=$(docker compose exec -T -e PGPASSWORD="$PW" db psql -U postgres -d postgres -h 127.0.0.1 -At -c \
  "select set_config('request.jwt.claims','$CLAIMS',false);" -c \
  "select public.save_cash_day_opening(json_build_object('business_date','$D4','denominations_json',json_build_object('100000',9))::jsonb);" 2>&1 || true)
END=$(date +%s.%N)
wait "$APID" || true
WAIT4=$(echo "$END - $START" | bc)
awk "BEGIN{exit !($WAIT4 >= $MINWAIT)}" \
  && echo "  PASS save_cash_day_opening blocked ${WAIT4}s (>= ${MINWAIT}s)" \
  || { echo "  FAIL save_cash_day_opening did not block (${WAIT4}s)"; FAIL=1; }
echo "$ERR4" | grep -q 'đã chốt két' \
  && echo "  PASS save_cash_day_opening raised guard after waiting" \
  || { echo "  FAIL save_cash_day_opening did not raise the final-close guard. Got: $ERR4"; FAIL=1; }

echo
[ "$FAIL" = 0 ] && echo "ALL RACE CHECKS PASSED" || { echo "RACE CHECKS FAILED"; exit 1; }
