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
// — implemented in Task 9; sendAnchorHeartbeat/fetchWhoami also take Record<string,string> auth headers (spread).

export async function listShopAnchors(supabase: SupabaseClient): Promise<ShopAnchor[]> {
  const { data, error } = await supabase.from("checkin_anchor").select("*").order("created_at");
  if (error) throw toAppError(error, "Không tải được danh sách thiết bị quán.");
  return (data ?? []) as ShopAnchor[];
}

export async function addShopAnchor(supabase: SupabaseClient, label: string, tokenHash: string): Promise<ShopAnchor> {
  const { data, error } = await supabase.rpc("add_shop_anchor", { p_label: label, p_token_hash: tokenHash });
  if (error) throw toAppError(error, "Không thêm được thiết bị quán.");
  return data as ShopAnchor;
}

export async function removeShopAnchor(supabase: SupabaseClient, anchorId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_shop_anchor", { p_anchor_id: anchorId });
  if (error) throw toAppError(error, "Không xoá được thiết bị quán.");
}

export async function updateCheckinNetworkConfig(supabase: SupabaseClient, config: CheckinNetworkConfig): Promise<CheckinNetworkConfig> {
  const { data, error } = await supabase.rpc("update_checkin_network_config", { p_config: config });
  if (error) throw toAppError(error, "Không cập nhật được cấu hình check-in.");
  return data as CheckinNetworkConfig;
}

export async function sendAnchorHeartbeat(anchorId: string, deviceToken: string, authHeaders: Record<string, string>): Promise<{ current_public_ip: string; last_heartbeat_at: string }> {
  const res = await fetch("/api/shop-presence/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({ anchor_id: anchorId, device_token: deviceToken }),
  });
  const body = (await res.json().catch(() => ({}))) as { current_public_ip?: string; last_heartbeat_at?: string; error?: string };
  if (!res.ok) throw new Error(body.error || "Không gửi được heartbeat.");
  return body as { current_public_ip: string; last_heartbeat_at: string };
}

export async function fetchWhoami(authHeaders: Record<string, string>): Promise<{ ip: string | null }> {
  const res = await fetch("/api/shop-presence/whoami", { headers: { ...authHeaders } });
  const body = (await res.json().catch(() => ({}))) as { ip?: string | null; error?: string };
  if (!res.ok) throw new Error(body.error || "Không lấy được IP.");
  return { ip: body.ip ?? null };
}
