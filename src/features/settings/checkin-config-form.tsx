"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useShopAnchorsQuery } from "@/hooks/queries/use-shop-anchors-query";
import {
  useAddShopAnchor,
  useRemoveShopAnchor,
  useUpdateCheckinNetworkConfig,
} from "@/hooks/mutations/use-checkin-mutations";
import { authHeader } from "@/lib/data/accounts";
import { sendAnchorHeartbeat, fetchWhoami } from "@/lib/data/checkin";
import { formatDateTime } from "@/lib/format";
import type { CheckinNetworkConfig, ShopAnchor } from "@/lib/types";

const DEFAULT_CONFIG: CheckinNetworkConfig = {
  enabled: false,
  reject_message: "Chỉ chấm công được khi ở tại quán (nối wifi quán).",
  grace_hours: 12,
};

/** SHA-256 hex of a string via Web Crypto — must match the heartbeat route's hash. */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** anchor "stale" when last heartbeat is older than grace_hours. */
function isStale(anchor: ShopAnchor, graceHours: number): boolean {
  if (!anchor.last_heartbeat_at) return true;
  const ageMs = Date.now() - new Date(anchor.last_heartbeat_at).getTime();
  return ageMs > Math.max(0, graceHours) * 60 * 60 * 1000;
}

/**
 * Owner-only panel (Task 9 / spec §5.5, §8): manage shop anchor devices + the
 * IP gate config. Mark THIS device as a shop anchor, see each anchor's public
 * IP + freshness, and toggle the check-in gate. The gate cannot be enabled
 * until at least one active anchor has a non-null IP (defense-in-depth: the
 * RPC enforces this server-side too).
 */
export function CheckinConfigForm() {
  const supabase = useSupabase();
  const { toast } = useToast();

  const anchorsQuery = useShopAnchorsQuery(supabase, true);
  const addAnchor = useAddShopAnchor(supabase);
  const removeAnchor = useRemoveShopAnchor(supabase);
  const updateConfig = useUpdateCheckinNetworkConfig(supabase);

  // Own query for the checkin_network config row (AppSettings doesn't carry it).
  const configQuery = useQuery({
    queryKey: ["app-settings", "checkin_network"] as const,
    queryFn: async (): Promise<CheckinNetworkConfig> => {
      const { data, error } = await supabase!
        .from("app_settings")
        .select("value")
        .eq("key", "checkin_network")
        .maybeSingle();
      if (error) throw error;
      const value = (data?.value ?? null) as Partial<CheckinNetworkConfig> | null;
      return {
        enabled: value?.enabled ?? DEFAULT_CONFIG.enabled,
        reject_message: value?.reject_message ?? DEFAULT_CONFIG.reject_message,
        grace_hours:
          typeof value?.grace_hours === "number" ? value.grace_hours : DEFAULT_CONFIG.grace_hours,
      };
    },
    enabled: !!supabase,
  });

  // Editable config state (synced from server).
  const [enabled, setEnabled] = useState(DEFAULT_CONFIG.enabled);
  const [rejectMessage, setRejectMessage] = useState(DEFAULT_CONFIG.reject_message);
  const [graceHours, setGraceHours] = useState(String(DEFAULT_CONFIG.grace_hours));

  useEffect(() => {
    if (!configQuery.data) return;
    setEnabled(configQuery.data.enabled);
    setRejectMessage(configQuery.data.reject_message);
    setGraceHours(String(configQuery.data.grace_hours));
  }, [configQuery.data]);

  // Anchor marking state.
  const [anchorLabel, setAnchorLabel] = useState("Máy quán");
  const [marking, setMarking] = useState(false);

  // whoami readout.
  const [whoami, setWhoami] = useState<{ ip: string | null } | null>(null);
  const [whoamiError, setWhoamiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) return;
    (async () => {
      try {
        const headers = await authHeader(supabase);
        const res = await fetchWhoami(headers);
        if (!cancelled) {
          setWhoami(res);
          setWhoamiError(null);
        }
      } catch (e) {
        if (!cancelled) setWhoamiError(e instanceof Error ? e.message : "Không lấy được IP.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const anchors = anchorsQuery.data ?? [];
  const graceNum = Number(graceHours);
  const validGrace = Number.isFinite(graceNum) && graceNum >= 0;
  // At least one ACTIVE anchor with a non-null IP is required before enabling.
  const hasAnchorIp = anchors.some((a) => a.is_active && a.current_public_ip);
  const canEnable = hasAnchorIp;

  async function handleMarkDevice() {
    if (!supabase || marking) return;
    const label = anchorLabel.trim() || "Máy quán";
    setMarking(true);
    try {
      const token = crypto.randomUUID() + crypto.randomUUID();
      const hash = await sha256Hex(token);
      const created = (await addAnchor.mutateAsync({ label, tokenHash: hash })) as { id: string };
      const id = created.id;
      window.localStorage.setItem("checkin:anchorId", id);
      window.localStorage.setItem("checkin:anchorToken", token);
      // Fire one heartbeat immediately to populate current_public_ip.
      try {
        const headers = await authHeader(supabase);
        await sendAnchorHeartbeat(id, token, headers);
      } catch {
        // The anchor row exists; IP just won't show until the next heartbeat.
      }
      await anchorsQuery.refetch();
      toast({ semantic: "success", message: "Đã đánh dấu thiết bị này là máy quán." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không đánh dấu được thiết bị.",
      });
    } finally {
      setMarking(false);
    }
  }

  async function handleRemove(anchorId: string) {
    try {
      await removeAnchor.mutateAsync(anchorId);
      // If we removed THIS device, clear its local token too.
      if (window.localStorage.getItem("checkin:anchorId") === anchorId) {
        window.localStorage.removeItem("checkin:anchorId");
        window.localStorage.removeItem("checkin:anchorToken");
      }
      toast({ semantic: "success", message: "Đã gỡ thiết bị quán." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không gỡ được thiết bị.",
      });
    }
  }

  async function handleSaveConfig() {
    if (!validGrace || updateConfig.isPending) return;
    if (enabled && !canEnable) return; // guard — RPC also enforces this
    try {
      await updateConfig.mutateAsync({
        enabled,
        reject_message: rejectMessage.trim() || DEFAULT_CONFIG.reject_message,
        grace_hours: graceNum,
      });
      toast({ semantic: "success", message: "Đã lưu cấu hình chấm công." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được cấu hình.",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Chấm công tại quán (cổng IP)</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Đánh dấu thiết bị ở quán làm &quot;máy quán&quot; để hệ thống biết IP công cộng của
            quán. Nhân viên chỉ chấm công được khi nối wifi quán (cùng IP) và cổng đang bật.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-6">
        {/* whoami readout */}
        <div className="rounded-md bg-surface-muted px-3 py-2 text-xs text-ink-2">
          {whoamiError ? (
            <span className="text-danger">Không lấy được IP: {whoamiError}</span>
          ) : whoami ? (
            whoami.ip ? (
              <>IP server thấy cho thiết bị này: <strong className="text-ink">{whoami.ip}</strong></>
            ) : (
              <>
                IP server thấy cho thiết bị này: <strong className="text-ink">—</strong>{" "}
                (chưa cấu hình reverse-proxy đặt IP thật?)
              </>
            )
          ) : (
            <>Đang lấy IP server thấy…</>
          )}
        </div>

        {/* Anchor list */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-ink">Thiết bị quán (anchor)</h4>
          {anchorsQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner size={24} />
            </div>
          ) : anchorsQuery.isError ? (
            <AlertBanner variant="danger">
              {anchorsQuery.error instanceof Error
                ? anchorsQuery.error.message
                : "Không tải được danh sách thiết bị quán."}
            </AlertBanner>
          ) : anchors.length === 0 ? (
            <EmptyState
              icon="clock"
              title="Chưa có thiết bị quán"
              subtitle="Mở app trên một máy ở quán rồi nhấn 'Đánh dấu thiết bị này là máy quán'."
            />
          ) : (
            <ul className="space-y-2">
              {anchors.map((anchor) => {
                const stale = isStale(anchor, graceNum);
                const noIp = !anchor.current_public_ip;
                return (
                  <li
                    key={anchor.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-sm font-semibold text-ink">
                        {anchor.label}
                      </strong>
                      <span className="text-xs text-muted">
                        IP: {anchor.current_public_ip ?? "—"} ·{" "}
                        {anchor.last_heartbeat_at
                          ? `Heartbeat: ${formatDateTime(anchor.last_heartbeat_at)}`
                          : "Chưa heartbeat"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {noIp && (
                        <Badge variant="soft" semantic="warning">
                          Chưa có IP
                        </Badge>
                      )}
                      {anchor.is_active && stale && (
                        <Badge variant="solid" semantic="danger">
                          Quá hạn — check-in đang bị khoá
                        </Badge>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={removeAnchor.isPending}
                        onClick={() => handleRemove(anchor.id)}
                      >
                        Gỡ
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Mark this device */}
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="flex-1 min-w-[12rem]">
              <TextField
                label="Nhãn thiết bị"
                value={anchorLabel}
                onChange={(e) => setAnchorLabel(e.target.value)}
                disabled={marking}
                placeholder="Máy quán"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              loading={marking}
              onClick={handleMarkDevice}
            >
              Đánh dấu thiết bị này là máy quán
            </Button>
          </div>
        </div>

        {/* Gate config */}
        <div className="space-y-4 border-t border-border pt-4">
          <h4 className="text-sm font-semibold text-ink">Cổng chấm công</h4>

          {!canEnable && (
            <AlertBanner variant="warning">
              Chưa có thiết bị quán nào có IP — không thể bật cổng.
            </AlertBanner>
          )}

          {configQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Spinner size={24} />
            </div>
          ) : (
            <>
              <Switch
                label={enabled ? "Cổng đang bật" : "Cổng đang tắt"}
                checked={enabled}
                onCheckedChange={(next) => setEnabled(next)}
                disabled={!canEnable && !enabled}
              />
              <TextField
                label="Thông báo khi bị chặn (sai IP)"
                value={rejectMessage}
                onChange={(e) => setRejectMessage(e.target.value)}
                helper="Hiển thị cho nhân viên khi không nối wifi quán."
              />
              <TextField
                label="Số giờ giữ IP (grace_hours)"
                type="number"
                inputMode="numeric"
                min={0}
                value={graceHours}
                onChange={(e) => setGraceHours(e.target.value)}
                error={validGrace ? undefined : "Phải là số >= 0."}
                helper="Anchor im lặng quá số giờ này thì IP rớt khỏi danh sách (cổng khoá)."
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  loading={updateConfig.isPending}
                  disabled={!validGrace || (enabled && !canEnable)}
                  onClick={handleSaveConfig}
                >
                  Lưu cấu hình
                </Button>
              </div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
