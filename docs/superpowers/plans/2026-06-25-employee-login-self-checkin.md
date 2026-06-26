# Employee Login Self-Check-in — Implementation Plan (v2, post-review)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

> **For Codex reviewer:** Derived from `docs/superpowers/specs/2026-06-25-employee-login-self-checkin-design.md` (which incorporates Codex review rounds 1 + 2 and the internal verification pass). The kiosk-PIN plan/spec are ⛔ SUPERSEDED. This v2 folds in all blockers/should-fixes: see **§A. Fix-map** and **§B. Coverage**. Tasks are ordered so the codebase compiles after each.

**Goal:** Employees log in (Supabase email+password) and self-check-in from their phone; accepted only when authenticated as an active linked `employee_self_service` AND the request egresses from the shop's *fresh* whitelisted public IP, arriving *through the reverse proxy*. Identity is from the verified session; each check-in is stamped with IP + user-agent. Check-OUT stays operator-only.

**Tech Stack:** Next.js 15 (`runtime="nodejs"`), React 19, TS, Supabase (Postgres local, service-role + RLS), pgTAP, Vitest, TanStack Query, Tailwind/Radix, `node:crypto`.

---

## Task ordering (compile-safe)
1. `ip-allowlist` util + tests
2. `rate-limit` util + tests
3. **Role + view wiring** (TS: UserRole, requireAuth, navigation, page.tsx router) — nothing else compiles without this
4. **Database** (CHECK swap, columns, fail-fast indexes, anchor, settings, RPCs, RLS lockdown) + pgTAP
5. **`/api/checkin`** route (proxy-secret, fail-closed 503, fresh-anchor gate) + data layer + types
6. **Heartbeat + whoami** routes
7. **Provisioning** — approve link-existing + **role ceiling** across approve/users POST/users PATCH
8. **Employee "Chấm công" screen** + consent + view mount
9. **Owner anchor/gate panel** + heartbeat hook + **audit-column render** in shift view
10. **Password reset**
11. **Deployment hardening** (loopback bind + proxy secret) + docs + full verification

---

## Task 1: `src/lib/ip-allowlist.ts` + Vitest
(Unchanged — full code.)

- [ ] **Step 1: Failing test** `src/lib/__tests__/ip-allowlist.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseClientIp, ipEquals, isIpAllowed } from "@/lib/ip-allowlist";
const H = (h: Record<string, string>) => new Headers(h);
describe("parseClientIp", () => {
  it("right-most hop, one proxy (ignores spoofed left)", () => { expect(parseClientIp(H({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedProxyCount: 1 })).toBe("9.9.9.9"); });
  it("single value", () => { expect(parseClientIp(H({ "x-forwarded-for": "9.9.9.9" }), { trustedProxyCount: 1 })).toBe("9.9.9.9"); });
  it("trustedProxyCount=2", () => { expect(parseClientIp(H({ "x-forwarded-for": "1.1.1.1, 8.8.8.8, 10.0.0.1" }), { trustedProxyCount: 2 })).toBe("8.8.8.8"); });
  it("platform header preferred", () => { expect(parseClientIp(H({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedProxyCount: 1, trustedHeader: "cf-connecting-ip" })).toBe("203.0.113.7"); });
  it("null when no header", () => { expect(parseClientIp(H({}), { trustedProxyCount: 1 })).toBeNull(); });
  it("null when fewer hops", () => { expect(parseClientIp(H({ "x-forwarded-for": "9.9.9.9" }), { trustedProxyCount: 2 })).toBeNull(); });
  it("IPv6 normalised", () => { expect(parseClientIp(H({ "x-forwarded-for": "[2001:DB8::1%eth0]" }), { trustedProxyCount: 1 })).toBe("2001:db8::1"); });
});
describe("ipEquals", () => {
  it("IPv4 exact", () => { expect(ipEquals("203.0.113.7","203.0.113.7")).toBe(true); expect(ipEquals("203.0.113.7","203.0.113.8")).toBe(false); });
  it("IPv6 forms", () => { expect(ipEquals("2001:0db8:0000:0000:0000:0000:0000:0001","2001:db8::1")).toBe(true); });
  it("IPv6 /64", () => { expect(ipEquals("2001:db8::abcd","2001:db8::1",{ipv6Prefix64:true})).toBe(true); expect(ipEquals("2001:db8:0:1::1","2001:db8::1",{ipv6Prefix64:true})).toBe(false); });
  it("null never matches", () => { expect(ipEquals(null,"1.2.3.4")).toBe(false); });
});
describe("isIpAllowed", () => {
  it("exact match true", () => { expect(isIpAllowed("203.0.113.7",["198.51.100.1","203.0.113.7"])).toBe(true); });
  it("null fail-closed", () => { expect(isIpAllowed(null,["203.0.113.7"])).toBe(false); });
  it("empty allowlist false", () => { expect(isIpAllowed("203.0.113.7",[])).toBe(false); });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `src/lib/ip-allowlist.ts`:

```ts
export interface ParseClientIpOptions { trustedProxyCount?: number; trustedHeader?: string | null; }
export interface IpMatchOptions { ipv6Prefix64?: boolean; }
function normaliseIp(raw: string | null | undefined): string {
  if (!raw) return ""; let s = raw.trim();
  if (s.startsWith("[")) s = s.slice(1); if (s.endsWith("]")) s = s.slice(0, -1);
  const pct = s.indexOf("%"); if (pct >= 0) s = s.slice(0, pct);
  return s.toLowerCase();
}
function isIpv6(ip: string): boolean { return ip.includes(":"); }
function expandIpv6(ip: string): string[] | null {
  if (ip.includes(".")) return null;
  const halves = ip.split("::"); if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 && missing < 1) return null;
  const middle = halves.length === 2 ? Array(missing).fill("0") : [];
  const parts = [...head, ...middle, ...tail]; if (parts.length !== 8) return null;
  return parts.map((p) => { const n = parseInt(p || "0", 16); return Number.isNaN(n) || n < 0 || n > 0xffff ? "INVALID" : n.toString(16); });
}
export function parseClientIp(headers: Headers, opts: ParseClientIpOptions = {}): string | null {
  const trustedProxyCount = Math.max(1, opts.trustedProxyCount ?? 1);
  if (opts.trustedHeader) { const n = normaliseIp(headers.get(opts.trustedHeader)); if (n) return n; }
  const xff = headers.get("x-forwarded-for"); if (!xff) return null;
  const parts = xff.split(",").map((p) => normaliseIp(p)).filter(Boolean);
  if (parts.length < trustedProxyCount) return null;
  return parts[parts.length - trustedProxyCount] ?? null;
}
export function ipEquals(a: string | null | undefined, b: string | null | undefined, opts: IpMatchOptions = {}): boolean {
  const na = normaliseIp(a), nb = normaliseIp(b); if (!na || !nb) return false;
  if (isIpv6(na) && isIpv6(nb)) {
    const ea = expandIpv6(na), eb = expandIpv6(nb);
    if (!ea || !eb || ea.includes("INVALID") || eb.includes("INVALID")) return na === nb;
    const len = opts.ipv6Prefix64 ? 4 : 8;
    for (let i = 0; i < len; i++) if (ea[i] !== eb[i]) return false;
    return true;
  }
  return na === nb;
}
export function isIpAllowed(ip: string | null | undefined, allowlist: string[], opts: IpMatchOptions = {}): boolean {
  const n = normaliseIp(ip); if (!n) return false;
  return allowlist.some((entry) => ipEquals(n, entry, opts));
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat(checkin): ip-allowlist util + tests`.

---

## Task 2: `src/lib/rate-limit.ts` + Vitest
(Unchanged — full code as in spec; time injected.)

- [ ] **Step 1: Failing test** `src/lib/__tests__/rate-limit.test.ts` — allow-up-to-max-then-block; reset after window; independent keys; sweep evicts. (Same as v1.)
- [ ] **Step 2: Run → FAIL. Step 3: Implement:**

```ts
export interface RateLimiterOptions { max: number; windowMs: number; }
export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterMs: number; }
export function createRateLimiter({ max, windowMs }: RateLimiterOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  function check(key: string, now: number): RateLimitResult {
    const b = buckets.get(key);
    if (!b || now >= b.resetAt) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true, remaining: max - 1, retryAfterMs: 0 }; }
    if (b.count < max) { b.count += 1; return { allowed: true, remaining: max - b.count, retryAfterMs: 0 }; }
    return { allowed: false, remaining: 0, retryAfterMs: b.resetAt - now };
  }
  function sweep(now: number): void { for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k); }
  return { check, sweep, size: () => buckets.size };
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat(checkin): rate limiter + tests`.

---

## Task 3: Role + view wiring (B1, B2 — must land before anything references the role/view)

**Files:** `src/lib/types.ts`, `src/lib/supabase/server.ts`, `src/features/navigation/navigation.ts`, `src/app/page.tsx`

- [ ] **Step 1: `UserRole`** — `src/lib/types.ts:3`: add `"employee_self_service"`:
```ts
export type UserRole = "owner" | "manager" | "staff_operator" | "employee_viewer" | "employee_self_service";
```
- [ ] **Step 2: `requireAuth` union** — `src/lib/supabase/server.ts:52,55`: add `"employee_self_service"` to both the `allowedRoles` param union and the return `role` union (or change both to `UserRole`).
- [ ] **Step 3: navigation.ts** — add to `ViewKey` (`navigation.ts:5-7`) the member `"checkin"`; add a `NAV_ITEMS` entry `{ key: "checkin", label: "Chấm công", icon: "clock" }` (match the real item shape); add the 5th key to **all three** `Record<UserRole,…>` maps — `DEFAULT_SIDEBAR_BY_ROLE.employee_self_service = ["checkin"]`, `MOBILE_TAB_PREFERENCE.employee_self_service = ["checkin"]`, `ROLE_LABELS.employee_self_service = "Nhân viên"`. (Maps are exhaustive over `UserRole` → TS forces these.)
- [ ] **Step 4: stub CheckinScreen + wire the view router now (B3).** Create `src/features/checkin/checkin-screen.tsx` as a stub so the build is green between tasks (fleshed out in Task 8):
```tsx
export function CheckinScreen() { return null; } // STUB — implemented in Task 8
```
Then in `src/app/page.tsx` (~313-341) import it and add the branch `{view === "checkin" && <CheckinScreen />}`. (Conditional `&&` branches don't force exhaustiveness, but wiring it now keeps the new `ViewKey` reachable and the import valid.)
- [ ] **Step 5: Typecheck** `npx tsc --noEmit` → clean (all three `Record<UserRole,…>` maps now have the 5th key; `requireAuth` unions widened).
- [ ] **Step 6: Commit** `feat(checkin): wire employee_self_service role + checkin view (stub screen)`.

---

## Task 4: Database — schema, RPCs, RLS, migration + pgTAP (B5/B6, C4/R6, C5/R5, S5, dual-write)

TDD: write `310_self_checkin.sql` first; run on a **throwaway DB** (§C); fail; implement; pass. Dual-write each block into BOTH `database/migrations/2026-06-25-employee-self-checkin.sql` and its canonical file.

### Canonical blocks

**(a) Named role CHECK constraint (B6) → migration + `001_schema.sql`.** First make `001_schema.sql:56` name the constraint: `constraint employee_accounts_role_check check (role in ('owner','manager','staff_operator','employee_viewer','employee_self_service'))`. Migration (idempotent, handles the historically-unnamed constraint by looking it up):
```sql
do $$
declare v_name text; v_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
  from pg_constraint c
  where c.conrelid = 'public.employee_accounts'::regclass and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%role%in%';
  if v_name is not null and position('employee_self_service' in v_def) = 0 then
    execute format('alter table public.employee_accounts drop constraint %I', v_name);
    v_name := null;
  end if;
  if v_name is null then
    alter table public.employee_accounts add constraint employee_accounts_role_check
      check (role in ('owner','manager','staff_operator','employee_viewer','employee_self_service'));
  end if;
end $$;
```

**(b) `shift_assignments` columns → migration + `001_schema.sql`:**
```sql
alter table public.shift_assignments add column if not exists check_in_ip inet;
alter table public.shift_assignments add column if not exists check_in_user_agent text;
```

**(c) FAIL-FAST preflight + partial unique index on open shifts (C4/R6, S5) → migration + `001_schema.sql`:**
```sql
do $$
declare v_dupe int;
begin
  delete from public.shift_assignments sa using (
    select id, row_number() over (
      partition by employee_id, business_date
      order by check_in_at asc nulls first, created_at asc, id asc) rn
    from public.shift_assignments where status = 'checked_in'
  ) d
  where sa.id = d.id and d.rn > 1
    and not exists (select 1 from public.shift_payroll_records p where p.shift_assignment_id = sa.id);
  select count(*) into v_dupe from (
    select employee_id, business_date from public.shift_assignments
    where status = 'checked_in' group by employee_id, business_date having count(*) > 1
  ) x;
  if v_dupe > 0 then
    raise exception 'Khong the tao unique index open-shift: con % nhom trung co payroll. Don tay roi chay lai.', v_dupe;
  end if;
  create unique index if not exists shift_assignments_one_open_per_day
    on public.shift_assignments (employee_id, business_date) where status = 'checked_in';
end $$;
```

**(d) FAIL-FAST preflight + unique `employee_accounts.employee_id` (B5, C4) → migration + `001_schema.sql`:**
```sql
do $$
declare v_dupe int;
begin
  -- reconcile payroll-free duplicate accounts is unsafe (accounts ≠ shifts); fail-fast on ANY dup.
  select count(*) into v_dupe from (
    select employee_id from public.employee_accounts where employee_id is not null
    group by employee_id having count(*) > 1
  ) x;
  if v_dupe > 0 then
    raise exception 'Khong the tao unique employee_id: % nhan vien co >1 tai khoan. Don tay roi chay lai.', v_dupe;
  end if;
  create unique index if not exists employee_accounts_one_account_per_employee
    on public.employee_accounts (employee_id) where employee_id is not null;
end $$;
```

**(e) `checkin_anchor` table → migration + `001_schema.sql`:**
```sql
create table if not exists public.checkin_anchor (
  id uuid primary key default gen_random_uuid(), label text not null,
  device_token_hash text not null, current_public_ip inet, last_heartbeat_at timestamptz,
  is_active boolean not null default true, created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists checkin_anchor_active_idx on public.checkin_anchor(is_active) where is_active;
drop trigger if exists checkin_anchor_set_updated_at on public.checkin_anchor;
create trigger checkin_anchor_set_updated_at before update on public.checkin_anchor
  for each row execute function public.set_updated_at();
```

**(f) Settings → migration + `004_seed.sql`** (`enabled:false` = feature OFF/503 until owner configures):
```sql
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"enabled": false, "reject_message": "Chỉ chấm công được khi ở tại quán (nối wifi quán).", "grace_hours": 12}'::jsonb, false)
on conflict (key) do nothing;
```

**(g) `check_in_self` (service-role-only) → migration + `002_functions.sql`:**
```sql
create or replace function public.check_in_self(p_auth_user_id uuid, p_ip inet, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_employee uuid; v_name text; v_id uuid; v_already boolean := false; v_check_in timestamptz := now(); v_date date := current_date;
begin
  if p_auth_user_id is null then raise exception 'Thiếu danh tính.'; end if;
  select ea.employee_id, e.name into v_employee, v_name
    from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
    where ea.auth_user_id = p_auth_user_id and ea.status = 'active' limit 1;
  if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;
  insert into public.shift_assignments
    (employee_id, business_date, check_in_at, status, created_by, updated_by, check_in_ip, check_in_user_agent)
  values (v_employee, v_date, v_check_in, 'checked_in', p_auth_user_id, p_auth_user_id, p_ip, p_user_agent)
  on conflict (employee_id, business_date) where status = 'checked_in' do nothing
  returning id into v_id;
  if v_id is null then
    v_already := true;
    select id into v_id from public.shift_assignments
      where employee_id = v_employee and business_date = v_date and status = 'checked_in'
      order by check_in_at desc limit 1;
  end if;
  select check_in_at into v_check_in from public.shift_assignments where id = v_id;
  return jsonb_build_object('shift_assignment_id', v_id, 'employee_name', v_name, 'check_in_at', v_check_in, 'already_checked_in', v_already);
end; $$;
revoke execute on function public.check_in_self(uuid, inet, text) from anon, authenticated;
grant execute on function public.check_in_self(uuid, inet, text) to service_role;
```
> N3: the `ON CONFLICT … WHERE status='checked_in'` predicate is byte-identical to index (c). N5: SECURITY DEFINER is safe — route validates caller → trusted `p_auth_user_id`; no `auth.uid()`; REVOKE from anon/authenticated.

**(h) `get_my_checkin_status` (authenticated own-data) → migration + `002_functions.sql`:**
```sql
create or replace function public.get_my_checkin_status()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_employee uuid; v_name text; v_in timestamptz; v_found boolean;
begin
  select ea.employee_id, e.name into v_employee, v_name
    from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
    where ea.auth_user_id = auth.uid() and ea.status = 'active' limit 1;
  if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;
  select check_in_at into v_in from public.shift_assignments
    where employee_id = v_employee and business_date = current_date and status = 'checked_in'
    order by check_in_at desc limit 1;
  v_found := found;
  return jsonb_build_object('employee_name', v_name, 'checked_in_today', v_found, 'check_in_at', case when v_found then v_in else null end);
end; $$;
```

**(i) Anchor RPCs (owner-only) → migration + `002_functions.sql`** (inlined, S2 — no external reference):
```sql
create or replace function public.add_shop_anchor(p_label text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v public.checkin_anchor%rowtype;
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cấu hình thiết bị quán.'; end if;
  if p_label is null or length(btrim(p_label)) = 0 then raise exception 'Nhãn thiết bị trống.'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'Token thiết bị không hợp lệ.'; end if;
  insert into public.checkin_anchor (label, device_token_hash, is_active, created_by)
  values (btrim(p_label), lower(p_token_hash), true, auth.uid()) returning * into v;
  return jsonb_build_object('id', v.id, 'label', v.label, 'is_active', v.is_active);
end; $$;

create or replace function public.remove_shop_anchor(p_anchor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cấu hình thiết bị quán.'; end if;
  delete from public.checkin_anchor where id = p_anchor_id;
  return jsonb_build_object('removed', p_anchor_id);
end; $$;

create or replace function public.record_shop_anchor_heartbeat(p_anchor_id uuid, p_public_ip inet)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v public.checkin_anchor%rowtype;
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cập nhật thiết bị quán.'; end if;
  update public.checkin_anchor set current_public_ip = p_public_ip, last_heartbeat_at = now()
   where id = p_anchor_id returning * into v;
  if not found then raise exception 'Không tìm thấy thiết bị quán.'; end if;
  return jsonb_build_object('id', v.id, 'current_public_ip', host(v.current_public_ip), 'last_heartbeat_at', v.last_heartbeat_at);
end; $$;

create or replace function public.update_checkin_network_config(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cập nhật cấu hình check-in.'; end if;
  if jsonb_typeof(p_config) <> 'object' or not (p_config ? 'enabled') or not (p_config ? 'reject_message')
     or not (p_config ? 'grace_hours') or jsonb_typeof(p_config->'enabled') <> 'boolean'
     or (p_config->>'grace_hours')::numeric < 0 then raise exception 'Cấu hình check-in không hợp lệ.'; end if;
  -- R7/C3 guard: cannot enable until at least one active anchor has a non-null IP.
  if (p_config->>'enabled')::boolean = true
     and not exists (select 1 from public.checkin_anchor where is_active and current_public_ip is not null) then
    raise exception 'Chưa có thiết bị quán nào có IP — không thể bật cổng check-in.';
  end if;
  insert into public.app_settings (key, value, is_public, updated_by)
  values ('checkin_network', p_config, false, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = false, updated_by = auth.uid(), updated_at = now();
  return p_config;
end; $$;
```

**(i-bis) `fresh_anchor_ips` (service-role-only read; freshness computed in Postgres — R7/S9/N3) → migration + `002_functions.sql`:**
```sql
create or replace function public.fresh_anchor_ips(p_grace_hours numeric)
returns setof text language sql security definer set search_path = public, auth as $$
  select host(current_public_ip) from public.checkin_anchor
  where is_active and current_public_ip is not null
    and last_heartbeat_at > now() - make_interval(hours => greatest(0, p_grace_hours)::int);
$$;
revoke execute on function public.fresh_anchor_ips(numeric) from anon, authenticated;
grant execute on function public.fresh_anchor_ips(numeric) to service_role;
```
> Uses `make_interval(hours => …)` (not string concat — N3). Service-role-only so anchor IPs aren't client-readable; the `/api/checkin` route (service role) calls it.

**(j) RLS + grants → migration + `003_rls.sql`:**
- After line 57 (both service-role-only fns): `revoke execute on function public.check_in_self(uuid, inet, text) from anon, authenticated; grant execute on function public.check_in_self(uuid, inet, text) to service_role; revoke execute on function public.fresh_anchor_ips(numeric) from anon, authenticated; grant execute on function public.fresh_anchor_ips(numeric) to service_role;`
- `checkin_anchor` owner-only RLS (enable + `checkin_anchor_owner_read` select owner + `checkin_anchor_no_direct_write` all false).
- **Operational-table lockdown (C5/R5)** — change the five `*_select_all` policies (`003_rls.sql:300-309`) from `using (true)` to exclude the new role:
```sql
drop policy if exists ingredients_select_all on public.ingredients;
create policy ingredients_select_all on public.ingredients for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
-- repeat identically for menu_items_select_all, recipes_select_all, recipe_items_select_all, stock_movements_select_all
```
- Migration-only explicit grants (authenticated, app_role-gated): `add_shop_anchor(text,text)`, `remove_shop_anchor(uuid)`, `record_shop_anchor_heartbeat(uuid,inet)`, `update_checkin_network_config(jsonb)`, `get_my_checkin_status()`.

**(k) Header comment** in `002_functions.sql` — append the new function names.

### Migration assembly
`2026-06-25-employee-self-checkin.sql` = header + blocks **(a)→(j)** in order, idempotent. The fail-fast DO blocks (c),(d) mean a populated DB with unrecoverable duplicates aborts the migration by design.

### pgTAP `database/tests/310_self_checkin.sql`

- [ ] **Step 1: Failing test.** Cover (group → assertion count):
  - check_in_self: stamps own employee/created_by/ip/ua, `check_in_at≈now()`, idempotent (2nd → `already_checked_in`, one row), unlinked account → throws — **~6**.
  - privilege lock-down: `has_function_privilege` for `check_in_self(uuid, inet, text)` AND `fresh_anchor_ips(numeric)` (N4 exact sigs) → anon=false, authenticated=false, service_role=true — **~6**.
  - `fresh_anchor_ips`: a fresh anchor IP is returned; a stale (`last_heartbeat_at` < now−grace) or null-IP anchor is excluded — **~2**.
  - `get_my_checkin_status` returns caller status — **~1**.
  - anchor owner-only (manager → `%quyền%`), heartbeat stamps IP + `last_heartbeat_at`, `update_checkin_network_config` enable-without-IP → throws — **~3**.
  - `employee_accounts(employee_id)` unique blocks a 2nd link — **~1**.
  - **C5/R5 RLS**: `act_as` `employee_self_service` + `set local role authenticated` → `select count(*)` on **all five** (`ingredients`, `menu_items`, `recipes`, `recipe_items`, `stock_movements`) = 0; a staff role sees > 0 — **~6** (or 5+1).
  - **Set `plan(N)` to the exact total (estimate ≈25; the worker MUST recount actual `select`-test calls — S6/S11; runner fails on mismatch).**
- [ ] **Step 2: Run on throwaway DB → FAIL.**
- [ ] **Step 3: Implement** blocks (a)–(k).
- [ ] **Step 4: Populated-DB migration tests (S7, runnable):** on a throwaway DB, (i) seed two payroll-free `checked_in` rows for one `(employee,date)` (index absent) → run migration → assert one row remains + index exists; (ii) seed two with one carrying a `shift_payroll_records` row → run migration → assert it **raises** and the index is absent. Concrete: apply `001`(minus new indexes)→`002`→`003`, `psql` the seed, then `psql -f migration`, asserting via `\echo`/`SELECT`. Run on `chill_pgtap`, not `supabase-db`.
- [ ] **Step 5: Apply `001→004` to throwaway DB, run pgTAP → PASS.**
- [ ] **Step 6: Dual-write self-check** (byte-identical migration ↔ canonical).
- [ ] **Step 7: Commit** `feat(checkin): DB self-checkin RPC + indexes(fail-fast) + RLS lockdown + pgTAP`.

---

## Task 5: `POST /api/checkin` + data layer + types (B3, B4, C1, C3, R7)

**Files:** Create `src/app/api/checkin/route.ts`, `src/lib/data/checkin.ts`; Modify `src/lib/data/index.ts`, `src/lib/types.ts`

- [ ] **Step 1: Route** `src/app/api/checkin/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import { parseClientIp, isIpAllowed } from "@/lib/ip-allowlist";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createRateLimiter({ max: Number(process.env.CHECKIN_RATE_MAX ?? 10), windowMs: Number(process.env.CHECKIN_RATE_WINDOW_MS ?? 60_000) });
const trustedProxyCount = () => Math.max(1, Number(process.env.CHECKIN_TRUSTED_PROXY_COUNT ?? 1));
function safeEquals(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

export async function POST(req: NextRequest) {
  // (C1/S2) proxy-secret: require it in production; a missing secret in prod fails CLOSED (503),
  // never silently disables the proxy barrier. In dev (no proxy in front) it is skipped — documented.
  const proxySecret = process.env.CHECKIN_PROXY_SECRET;
  if (!proxySecret) {
    if (process.env.NODE_ENV === "production")
      return NextResponse.json({ error: "Tính năng chấm công chưa được cấu hình (proxy)." }, { status: 503 });
  } else {
    const presented = req.headers.get("x-checkin-proxy-secret") || "";
    if (!safeEquals(presented, proxySecret)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // (B4) employees only; operators use the existing check_in_employee flow.
  let userId: string;
  try { ({ userId } = await requireAuth(req.headers.get("authorization"), ["employee_self_service"])); }
  catch (e) { const m = e instanceof Error ? e.message : "Auth failed."; return NextResponse.json({ error: m }, { status: m.includes("Authorization") || m.includes("Token") ? 401 : 403 }); }

  const supabase = getServiceRoleClient();

  // (C3) fail-closed config read.
  const { data: cfgRow, error: cfgErr } = await supabase.from("app_settings").select("value").eq("key", "checkin_network").maybeSingle();
  if (cfgErr || !cfgRow) return NextResponse.json({ error: "Tính năng chấm công chưa được cấu hình." }, { status: 503 });
  const cfg = cfgRow.value as { enabled?: boolean; reject_message?: string; grace_hours?: number };
  if (typeof cfg?.enabled !== "boolean" || typeof cfg?.grace_hours !== "number") return NextResponse.json({ error: "Cấu hình chấm công không hợp lệ." }, { status: 503 });
  if (cfg.enabled !== true) return NextResponse.json({ error: "Tính năng chấm công đang tắt." }, { status: 503 });
  const rejectMessage = cfg.reject_message || "Chỉ chấm công được khi ở tại quán (nối wifi quán).";

  // (R7) fresh anchors, cutoff computed in Postgres via a filter on an ISO string is clock-skew-prone;
  // use an RPC that filters with now() server-side. Read via a small SECURITY DEFINER helper OR
  // filter with .gt('last_heartbeat_at', 'now() - interval') — Postgres can't take an expression in PostgREST,
  // so call a dedicated read RPC:
  const { data: anchors, error: anchErr } = await supabase.rpc("fresh_anchor_ips", { p_grace_hours: cfg.grace_hours });
  if (anchErr) return NextResponse.json({ error: "Lỗi đọc thiết bị quán." }, { status: 503 });
  const allow = ((anchors as string[] | null) ?? []).filter(Boolean);
  if (allow.length === 0) return NextResponse.json({ error: "Chưa có thiết bị quán hoạt động." }, { status: 503 });

  const ip = parseClientIp(req.headers, { trustedProxyCount: trustedProxyCount(), trustedHeader: process.env.CHECKIN_TRUSTED_IP_HEADER || null });
  if (!isIpAllowed(ip, allow)) return NextResponse.json({ error: rejectMessage }, { status: 403 });

  // (S1) rate-limit only AFTER auth + config + IP gate pass (matches spec §6 order; the write is what we throttle).
  const now = Date.now();
  const rl = limiter.check(userId, now); if (now % 64 === 0) limiter.sweep(now);
  if (!rl.allowed) return NextResponse.json({ error: "Bạn thử quá nhiều lần. Đợi một lát." }, { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } });

  const ua = req.headers.get("user-agent");
  const { data, error } = await supabase.rpc("check_in_self", { p_auth_user_id: userId, p_ip: ip, p_user_agent: ua });
  if (error) return NextResponse.json({ error: "Không chấm công được." }, { status: 400 });
  const r = data as { employee_name: string; check_in_at: string; already_checked_in: boolean };
  return NextResponse.json({ employee_name: r.employee_name, check_in_at: r.check_in_at, already_checked_in: r.already_checked_in });
}
```
> The `fresh_anchor_ips(numeric)` RPC is defined in Task 4 block **(i-bis)** (service-role-only; `make_interval`). Its REVOKE is also re-asserted in block (j) for the 003 path.

- [ ] **Step 2: Data layer** `src/lib/data/checkin.ts` — **B3 fix: `authHeader(supabase)` returns a headers OBJECT**, so `submitCheckin` takes/ spreads it and handles the empty (no-session) case:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShopAnchor, CheckinNetworkConfig, MyCheckinStatus } from "@/lib/types";
import { toAppError } from "./_common";
export interface CheckinResult { employee_name: string; check_in_at: string; already_checked_in: boolean; }

export async function submitCheckin(authHeaders: Record<string, string>): Promise<CheckinResult> {
  if (!authHeaders.Authorization) throw new Error("Phiên đăng nhập hết hạn. Hãy đăng nhập lại.");
  const res = await fetch("/api/checkin", { method: "POST", headers: { ...authHeaders } });
  const body = (await res.json().catch(() => ({}))) as Partial<CheckinResult> & { error?: string };
  if (!res.ok) throw new Error(body.error || "Không chấm công được.");
  return body as CheckinResult;
}
export async function getMyCheckinStatus(supabase: SupabaseClient): Promise<MyCheckinStatus> {
  const { data, error } = await supabase.rpc("get_my_checkin_status");
  if (error) throw toAppError(error, "Không tải được trạng thái."); return data as MyCheckinStatus;
}
// listShopAnchors / addShopAnchor / removeShopAnchor / updateCheckinNetworkConfig / sendAnchorHeartbeat / fetchWhoami
// — same as Task 9 needs; sendAnchorHeartbeat/fetchWhoami also take Record<string,string> auth headers (spread).
```
Add `export * from "./checkin";` to `index.ts`. Add to `src/lib/types.ts`: `ShopAnchor`, `CheckinNetworkConfig = { enabled: boolean; reject_message: string; grace_hours: number }`, `MyCheckinStatus = { employee_name: string; checked_in_today: boolean; check_in_at: string | null }`.

- [ ] **Step 3: Smoke** (dev 3009): without proxy secret env, a valid `employee_self_service` token → 503 "chưa cấu hình" (gate off) until configured; non-employee role → 403; no token → 401.
- [ ] **Step 4: Commit** `feat(checkin): authenticated /api/checkin (proxy-secret, fail-closed, fresh-anchor) + data`.

---

## Task 6: Heartbeat + whoami routes (owner + device token)

**Files:** Create `src/app/api/shop-presence/heartbeat/route.ts`, `.../whoami/route.ts`. Full bodies inlined (S2):

- [ ] **Step 1: heartbeat** — `requireAuth(authHeader, ["owner"])`; body `{anchor_id, device_token}`; service-role read of `device_token_hash`; constant-time compare `sha256(device_token)` (`node:crypto`); `parseClientIp` (null → 400); call `getUserClient(authHeader).rpc("record_shop_anchor_heartbeat", { p_anchor_id, p_public_ip: ip })`; return `{current_public_ip, last_heartbeat_at}`. (Same code as kiosk plan; reproduce here.)
- [ ] **Step 2: whoami** — `requireAuth(["owner"])`; return `{ ip: parseClientIp(...) }`.
- [ ] **Step 3: Commit** `feat(checkin): owner heartbeat + whoami routes`.

---

## Task 7: Provisioning — link existing employee + role ceiling (C2/R3, Codex#2)

**Files:** `src/app/api/signup-requests/[id]/approve/route.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/features/settings/approve-signup-modal.tsx`

- [ ] **Step 1: Role-ceiling helper (S3)** — add to `src/lib/supabase/server.ts` and export:
```ts
import type { UserRole } from "@/lib/types";
/** Only an owner may grant/modify the `owner` role. Throws (caller maps to 403). */
export function assertCanAssignRole(approverRole: UserRole, targetRole: UserRole): void {
  if (targetRole === "owner" && approverRole !== "owner") {
    throw new Error("Chỉ owner mới được cấp quyền owner.");
  }
}
```
- [ ] **Step 2: approve route** (`src/app/api/signup-requests/[id]/approve/route.ts`) — `VALID_ROLES` (line 24) → add `"employee_self_service"` (S4); after validating `role`, call `assertCanAssignRole(approver.role as UserRole, role as UserRole)` inside `try/catch` → `bad(msg, 403)` on throw; implement **link-existing** resolution (optional body `employee_id` → verify exists+unlinked; else single unlinked `employee_code` match → link; else insert) with a `createdEmployee` boolean so rollback only deletes a row WE created; on `employee_accounts` insert error `23505` (employee_id) → 409 "Nhân viên này đã có tài khoản.".
- [ ] **Step 3: users POST + PATCH (S3/S4)** — `src/app/api/users/route.ts` (`VALID_ROLES` :33) and `src/app/api/users/[id]/route.ts` (`VALID_ROLES` :25): add `"employee_self_service"` to **both** arrays; before any role create/update call `assertCanAssignRole(caller.role as UserRole, requestedRole as UserRole)` → 403 on throw. `/api/users` POST should also accept `employee_id` to link an existing employee (same invariant as approve).
- [ ] **Step 4: modal** — add `"employee_self_service"` to `ROLES`; add an optional "Link nhân viên có sẵn" `Combobox` (query unlinked employees); only owner sees `owner` in the role select (hide `owner` for manager approvers); default staff role `employee_self_service`.
- [ ] **Step 5: Tests** — manager approving/creating/patching to `owner` → 403; owner → ok; code-match links (no duplicate `employees`); already-linked → 409.
- [ ] **Step 6: Commit** `fix(checkin): approve/users link-existing + owner-only role ceiling`.

---

## Task 8: Employee "Chấm công" screen + consent + view mount (S4, B2)

**Files:** Create `src/features/checkin/checkin-screen.tsx`, `src/hooks/queries/use-my-checkin-status-query.ts`; Modify `src/hooks/queries/keys.ts`, `src/app/page.tsx`

- [ ] **Step 1: status query** — `queryKeys.myCheckinStatus()`; `useMyCheckinStatusQuery(supabase, enabled)` → `getMyCheckinStatus`.
- [ ] **Step 2: screen** (`"use client"`, mobile-first):
```tsx
"use client";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { useMyCheckinStatusQuery } from "@/hooks/queries/use-my-checkin-status-query";
import { authHeader } from "@/lib/data/accounts";
import { submitCheckin, type CheckinResult } from "@/lib/data/checkin";
import { queryKeys } from "@/hooks/queries/keys";
const fmtVN = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
export function CheckinScreen() {
  const supabase = useSupabase(); const qc = useQueryClient();
  const statusQ = useMyCheckinStatusQuery(supabase, true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [result, setResult] = useState<CheckinResult | null>(null);
  async function onCheckin() {
    if (!supabase || busy) return; setBusy(true); setError(null);
    try { const headers = await authHeader(supabase); const r = await submitCheckin(headers); setResult(r); qc.invalidateQueries({ queryKey: queryKeys.myCheckinStatus() }); }
    catch (e) { setError(e instanceof Error ? e.message : "Không chấm công được."); } finally { setBusy(false); }
  }
  const name = statusQ.data?.employee_name; const alreadyToday = statusQ.data?.checked_in_today;
  if (result) return (<main className="min-h-[60vh] flex items-center justify-center p-6"><div className="w-full max-w-sm rounded-2xl border p-8 text-center space-y-3"><div aria-hidden className="text-5xl">✓</div><h1 className="text-xl font-semibold">{result.already_checked_in ? "Bạn đã vào ca hôm nay rồi" : "Vào ca thành công"}</h1><p className="text-lg font-medium">{result.employee_name}</p><p className="text-sm text-muted">{fmtVN(result.check_in_at)}</p></div></main>);
  return (<main className="min-h-[60vh] flex items-center justify-center p-6"><div className="w-full max-w-sm rounded-2xl border p-8 space-y-5 text-center">
    <h1 className="text-xl font-semibold">Chấm công</h1>
    {name && <p className="text-sm text-muted">Xin chào, {name}</p>}
    {error && <AlertBanner variant="danger" onClose={() => setError(null)}>{error}</AlertBanner>}
    {alreadyToday ? <p className="text-emerald-600 font-medium">Bạn đã vào ca hôm nay.</p>
      : <Button variant="primary" loading={busy} onClick={onCheckin} className="w-full py-3 text-lg">Vào ca</Button>}
    <p className="text-xs text-muted">Khi chấm công, hệ thống ghi lại thời điểm, IP và thiết bị của bạn.</p>
  </div></main>);
}
```
- [ ] **Step 3: mount** — `src/app/page.tsx` view router: import `CheckinScreen` and add `{view === "checkin" && <CheckinScreen />}`.
- [ ] **Step 4: Verify** on a phone viewport as `employee_self_service`.
- [ ] **Step 5: Commit** `feat(checkin): employee Chấm công screen + consent + mount`.

---

## Task 9: Owner anchor/gate panel + heartbeat hook + audit render (S1, S3)

**Files:** Create `src/hooks/queries/use-shop-anchors-query.ts`, `src/hooks/mutations/use-checkin-mutations.ts`, `src/hooks/use-anchor-heartbeat.ts`, `src/components/checkin/anchor-heartbeat.tsx`, `src/features/settings/checkin-config-form.tsx`; Modify `src/hooks/queries/keys.ts`, `src/features/settings/settings-view.tsx`, the shift view component, the authed shell

- [ ] **Step 1:** `queryKeys.shopAnchors()`; `use-shop-anchors-query.ts` (`listShopAnchors`).
- [ ] **Step 2:** mutations — `useAddShopAnchor`/`useRemoveShopAnchor` (invalidate `shopAnchors`), `useUpdateCheckinNetworkConfig` (invalidate `appSettings`).
- [ ] **Step 3:** `use-anchor-heartbeat.ts` — on focus + 6h interval, if `localStorage` has `checkin:anchorId`+`checkin:anchorToken` and a session, `sendAnchorHeartbeat(id, token, await authHeader(supabase))`; swallow errors (grace). `<AnchorHeartbeat/>` mounts it once in the authed shell (`page.tsx`).
- [ ] **Step 4:** `checkin-config-form.tsx` (**owner-only render**, inline — S2):
  - anchor list: label + `current_public_ip ?? "—"` + `last_heartbeat_at` with a **red "Quá hạn — check-in đang bị khoá"** badge when older than `grace_hours`, and a **"Chưa có IP"** badge when `current_public_ip` is null; **Gỡ** per anchor.
  - "Đánh dấu thiết bị này là máy quán": `token = crypto.randomUUID()+crypto.randomUUID()`; `hash = sha256Hex(token)` via Web Crypto; `addAnchor.mutateAsync({label, tokenHash:hash})`; store `checkin:anchorId`/`checkin:anchorToken`; immediately `sendAnchorHeartbeat`.
  - gate editors: `enabled` Switch, `reject_message`, `grace_hours`; **disable the enable-Switch / block save when no active anchor has a non-null IP** (R7) with an inline warning; save via `updateCheckinNetworkConfig` (the RPC also enforces this server-side).
  - `fetchWhoami(await authHeader(supabase))` readout: "IP server thấy cho thiết bị này: …".
  - `sha256Hex` via `crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))` → hex.
- [ ] **Step 5:** `settings-view.tsx` — render `<CheckinConfigForm/>` only for `role === "owner"`.
- [ ] **Step 6 (S3): audit render** — in the shift list/grid component (find `src/features/shifts/*` `employee-grid`), for owner/manager/staff_operator show `check_in_ip` + `check_in_user_agent` per check-in (read in the shifts data query; add the columns to its select), with a subtle "khác thiết bị/khác IP" flag when an employee's check-in differs from their usual.
- [ ] **Step 7: Verify** — mark POS anchor → IP appears; cannot enable gate before an anchor IP exists; stale anchor → badge + check-in 503; fresh heartbeat → works; shift view shows IP/device.
- [ ] **Step 8: Commit** `feat(checkin): owner anchor/gate panel + heartbeat + shift audit render`.

---

## Task 10: Password reset (Codex round-1 spec §5.6)

**Files:** Modify `src/features/auth/login-screen.tsx`; Create the reset page (verify `/auth` route group; `/auth` is already in `PUBLIC_PATHS`, `middleware.ts:14`)

- [ ] **Step 1:** "Quên mật khẩu?" → `resetPasswordForEmail(email, { redirectTo: <origin>/auth/reset })`; neutral toast (no enumeration).
- [ ] **Step 2:** reset page listens for `PASSWORD_RECOVERY` → new-password form → `updateUser({ password })` → login.
- [ ] **Step 3: Verify; Step 4: Commit** `feat(auth): basic password reset`.

---

## Task 11: Deployment hardening (C1) + docs + full verification

**Files:** `deploy/dockge/compose.yaml`, `deploy/dockge/.env.example`, `database/README.md`, Create `docs/checkin-self-service-ops.md`

- [ ] **Step 1: Bind app to loopback + proxy (C1).** In `compose.yaml:39` change the app port publish to `"127.0.0.1:${APP_PORT:-3009}:3000"` so the raw port is not reachable off-host; document adding a reverse proxy (nginx/Caddy) as the only public listener that sets the real IP header and injects `x-checkin-proxy-secret`. Add `CHECKIN_PROXY_SECRET` (+ `CHECKIN_TRUSTED_PROXY_COUNT`, `CHECKIN_TRUSTED_IP_HEADER`, `CHECKIN_RATE_MAX/WINDOW_MS`) to `.env.example` and the app service env. Update `README.md` lines that advertise direct `http://<server-ip>:3009` access.
- [ ] **Step 2: Ops doc** `docs/checkin-self-service-ops.md`: the proxy/firewall **enforcement** (loopback bind + proxy secret + NTP sync prerequisite for the freshness window); env vars; Wi-Fi-only rule (4G blocked) + SSID sign; owner flow (provision via approve-with-link, mark anchor, the gate cannot be enabled until an anchor has an IP, freshness/503 behavior); role ceiling note; PDPL consent + retention for `check_in_ip`/`check_in_user_agent`; accepted risks (on-site password sharing; CGNAT; IPv6 /64 follow-up); rate-limiter per-process.
- [ ] **Step 3: README** — add `checkin_anchor`, the `checkin_network` seed, the new role, and the operational-table RLS change note.
- [ ] **Step 4: Full verification:**
```bash
npm run test:run                                            # Vitest: ip-allowlist + rate-limit + suite green
node scripts/pgtap-run.mjs --file database/tests/310_self_checkin.sql   # throwaway DB → all pass
npx tsc --noEmit                                            # role/view wiring compiles
```
- [ ] **Step 5: Manual E2E** (spec §10): provision an `employee_self_service` linked to a real employee; mark POS anchor; enable gate (blocked until anchor IP exists); employee on shop Wi-Fi → Vào ca → success; re-tap → "đã vào ca"; 4G → 403; off-shop IP via valid JWT through proxy → 403; **direct hit to the raw port (no proxy secret) → 403**; stale anchor → 503; double-`curl` race → one shift; operator checks out + payroll; owner sees IP/device + cannot read others' operational data as the new role.
- [ ] **Step 6: Commit** `chore(checkin): loopback bind + proxy secret + ops docs + verification`.

---

## §A. Fix-map (reviewer: verify each)
- **B1/R1** role wired across `UserRole`/`requireAuth`/3 nav maps/`ViewKey`/named CHECK — Task 3 + Task 4(a).
- **B2** `checkin` view + `page.tsx` router branch — Tasks 3, 8.
- **B3** `authHeader` returns an object → `submitCheckin(Record<string,string>)` + empty-session guard — Task 5.
- **B4** route restricted to `["employee_self_service"]`; operators stay on `check_in_employee` — Task 5.
- **B5/B6/C4/R6** both unique indexes **fail-fast (RAISE)**, named constraint, post-migration index verify, populated-DB tests — Task 4(a)(c)(d), Step 4.
- **C1/R2** loopback bind + reverse proxy + `CHECKIN_PROXY_SECRET` constant-time header + E2E — Tasks 5, 11.
- **C2/R3** owner-only role ceiling across approve + users POST + users PATCH + tests — Task 7.
- **C3/R4** fail-closed config: read-error/missing/`enabled=false` → 503; never skip-IP-and-allow — Task 5.
- **C5/R5** operational-table RLS excludes `employee_self_service` + pgTAP — Task 4(j), Step 1.
- **R7** fresh-anchor cutoff via Postgres RPC `fresh_anchor_ips`; null-IP excluded; gate cannot enable without an anchor IP (route + RPC + form) — Tasks 4(i), 5, 9.
- **S1** stale/null-IP handling + owner red badge — Tasks 5, 9. **S2** anchor RPCs + config form inlined. **S3** shift audit render — Task 9.6. **S4** consent — Task 8. **S5** deterministic dedup tiebreak — Task 4(c). **S6** count `plan(N)`. **S7** runnable populated-DB tests — Task 4.4.
- **Decisions:** check-OUT operator-only; rate-limit by `userId`; in-memory limiter; on-site password-sharing accepted (mitigated by stamp); Wi-Fi required; `verify:mirror` is the dashboard checker, not a dual-write tool.

## §B. Coverage (spec → task)
- PIN→login self-check-in on phone — 5, 8 · Supabase email+pw — 5, 10 · dual gate identity+IP, identity from session — 4, 5 · new least-priv role (RLS-enforced, C5) — 3, 4, 7 · self-IN only, OUT operator — 4, 5 · auto-confirm + IP/device stamp — 4, 9 · access history via stamp + `auth.audit_log_entries` — 4, 11 · Wi-Fi required + 4G message — 5, 8, 11 · provisioning link-existing + role ceiling + password reset — 7, 10 · atomic idempotency + fail-fast preflight — 4 · `check_in_self` service-role-only — 4 · raw-port enforcement — 5, 11 · fail-closed setup-state — 5 · anchor freshness/null-IP — 4, 5, 9 · anchor/parseClientIp/heartbeat reuse — 1, 6, 9 · Vitest + pgTAP (incl. role-blocked reads, privileges, populated-DB) — 1, 2, 4.

## §C. Verification environment
- Dev on **3009**; no `npm run build` while `next dev` runs.
- pgTAP via `node scripts/pgtap-run.mjs` on a **throwaway DB** (`chill_pgtap`), not `supabase-db` (seed collisions → ~13 false fails). Apply `001→004` (or the migration) first; the **fail-fast preflight** means a populated DB with unrecoverable dups aborts the migration — that is intended and is tested in Task 4 Step 4.
