-- =============================================================================
-- Migration: anchor heartbeat → SERVICE-ROLE-ONLY (token-only auth).
--
-- Problem fixed: record_shop_anchor_heartbeat was owner-gated (app_role()='owner')
-- and the /api/shop-presence/heartbeat route required an OWNER session. The in-shop
-- anchor device is normally logged in as a MANAGER (or staff), so heartbeats were
-- rejected (403) → the anchor went stale after grace_hours → check-in blocked (503).
--
-- Fix: the device token IS the credential. The route verifies the token
-- (constant-time) and writes via service role; no owner session needed. So the
-- always-on shop device keeps the anchor IP fresh under any logged-in session.
--
-- Dual-write of database/002_functions.sql + 003_rls.sql (byte-identical blocks).
-- Spec: docs/superpowers/specs/2026-06-25-employee-login-self-checkin-design.md
-- =============================================================================

-- SERVICE-ROLE-ONLY: /api/shop-presence/heartbeat verifies the device token
-- (constant-time) then calls this via service role. The device token IS the
-- credential — NO owner session required — so an always-on shop device keeps the
-- anchor IP fresh under ANY logged-in session (manager/staff). IP is route-read.
create or replace function public.record_shop_anchor_heartbeat(p_anchor_id uuid, p_public_ip inet)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v public.checkin_anchor%rowtype;
begin
  update public.checkin_anchor set current_public_ip = p_public_ip, last_heartbeat_at = now()
   where id = p_anchor_id returning * into v;
  if not found then raise exception 'Không tìm thấy thiết bị quán.'; end if;
  return jsonb_build_object('id', v.id, 'current_public_ip', host(v.current_public_ip), 'last_heartbeat_at', v.last_heartbeat_at);
end; $$;
revoke execute on function public.record_shop_anchor_heartbeat(uuid, inet) from public, anon, authenticated;
grant execute on function public.record_shop_anchor_heartbeat(uuid, inet) to service_role;
