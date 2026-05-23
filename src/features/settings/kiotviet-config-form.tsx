"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  loadKiotvietConfig,
  saveKiotvietConfig,
  type KvConfigDto,
} from "@/lib/data";

/**
 * Owner/manager-only form to configure the KiotViet connection.
 *
 * The form mirrors the visual rhythm of the other Settings cards
 * (SidebarConfigForm + HandoverDefaultTasksEditor): one Card, explicit
 * "Lưu thay đổi" / "Hủy" buttons, toast-based feedback, no dirty-state
 * tracking.
 *
 * Secret hygiene:
 *   - `client_secret`: the API never returns the stored value, only a mask.
 *     The form's input starts empty; leaving it empty on save preserves the
 *     existing secret. Typing into it replaces it.
 *   - `webhook_secret`: NOT touched by the main Save button. Only the two
 *     dedicated buttons ("Sinh secret mới" / "Thu hồi webhook") update it.
 *     This prevents the "saved retailer name, lost webhook" footgun.
 */
export function KiotvietConfigForm() {
  const supabase = useSupabase();
  const { toast } = useToast();

  const [retailer, setRetailer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [clientSecretMask, setClientSecretMask] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [scope, setScope] = useState("");
  const [rateLimit, setRateLimit] = useState(4);
  const [isActive, setIsActive] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [revealClientSecret, setRevealClientSecret] = useState(false);
  const [revealWebhookSecret, setRevealWebhookSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isWebhookBusy, setIsWebhookBusy] = useState(false);
  const [rateLimitError, setRateLimitError] = useState<string | undefined>(undefined);
  const [retailerError, setRetailerError] = useState<string | undefined>(undefined);
  const [clientIdError, setClientIdError] = useState<string | undefined>(undefined);

  const applyConfig = useCallback((cfg: KvConfigDto) => {
    setRetailer(cfg.retailer ?? "");
    setClientId(cfg.client_id ?? "");
    setClientSecret(""); // never preload the secret
    setClientSecretMask(cfg.client_secret_masked ?? "");
    setTokenUrl(cfg.token_url ?? "");
    setApiBase(cfg.api_base ?? "");
    setScope(cfg.scope ?? "");
    setRateLimit(cfg.rate_limit_per_sec ?? 4);
    setIsActive(Boolean(cfg.is_active));
    setWebhookSecret(cfg.webhook_secret ?? "");
    setRevealClientSecret(false);
    setRevealWebhookSecret(false);
    setRateLimitError(undefined);
    setRetailerError(undefined);
    setClientIdError(undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setIsLoading(true);
    try {
      const cfg = await loadKiotvietConfig(supabase);
      applyConfig(cfg);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không tải được cấu hình KiotViet.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [supabase, applyConfig, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ===== Save (main fields only — NOT webhook_secret) =====

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || isSaving) return;

    // Inline validation
    let blocked = false;
    if (isActive && retailer.trim() === "") {
      setRetailerError("Bắt buộc khi bật kết nối.");
      blocked = true;
    } else {
      setRetailerError(undefined);
    }
    if (isActive && clientId.trim() === "") {
      setClientIdError("Bắt buộc khi bật kết nối.");
      blocked = true;
    } else {
      setClientIdError(undefined);
    }
    if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10) {
      setRateLimitError("Phải là số nguyên trong 1–10.");
      blocked = true;
    } else {
      setRateLimitError(undefined);
    }
    if (blocked) return;

    const patch: Partial<KvConfigDto> = {
      retailer: retailer.trim(),
      client_id: clientId.trim(),
      token_url: tokenUrl.trim(),
      api_base: apiBase.trim(),
      scope: scope.trim(),
      rate_limit_per_sec: rateLimit,
      is_active: isActive,
    };
    // Only include client_secret if user actually typed a new value.
    const newSecret = clientSecret.trim();
    if (newSecret.length > 0) patch.client_secret = newSecret;
    // webhook_secret is NEVER sent from the Save button.

    setIsSaving(true);
    try {
      const cfg = await saveKiotvietConfig(supabase, patch);
      applyConfig(cfg);
      toast({ semantic: "success", message: "Đã lưu cấu hình KiotViet." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được cấu hình.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  // ===== Webhook controls =====

  async function handleGenerateWebhook() {
    if (!supabase || isWebhookBusy) return;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    setIsWebhookBusy(true);
    try {
      const cfg = await saveKiotvietConfig(supabase, { webhook_secret: next });
      applyConfig(cfg);
      setRevealWebhookSecret(true); // surface the new secret so user can copy
      toast({ semantic: "success", message: "Đã tạo webhook secret mới." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không tạo được webhook secret.",
      });
    } finally {
      setIsWebhookBusy(false);
    }
  }

  async function handleRevokeWebhook() {
    if (!supabase || isWebhookBusy) return;
    if (!confirm("Thu hồi webhook? KiotViet sẽ không gọi được endpoint này nữa.")) return;
    setIsWebhookBusy(true);
    try {
      const cfg = await saveKiotvietConfig(supabase, { webhook_secret: "" });
      applyConfig(cfg);
      toast({ semantic: "success", message: "Đã thu hồi webhook." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không thu hồi được webhook.",
      });
    } finally {
      setIsWebhookBusy(false);
    }
  }

  async function handleCopyWebhookUrl() {
    if (!webhookSecret) return;
    const url = composeWebhookUrl(webhookSecret);
    try {
      await navigator.clipboard.writeText(url);
      toast({ semantic: "success", message: "Đã copy URL webhook." });
    } catch {
      toast({ semantic: "danger", message: "Không copy được. Hãy bôi đen và copy thủ công." });
    }
  }

  // ===== Render =====

  if (isLoading) {
    return (
      <Card>
        <CardBody className="flex justify-center py-8">
          <Spinner size={32} />
        </CardBody>
      </Card>
    );
  }

  const clientSecretPlaceholder = clientSecretMask
    ? `Để trống = giữ nguyên (${clientSecretMask})`
    : "Chưa cấu hình";
  const webhookUrl = webhookSecret ? composeWebhookUrl(webhookSecret) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kết nối KiotViet</CardTitle>
      </CardHeader>
      <CardBody>
        <AlertBanner variant="info">
          Owner/manager only. Secrets được lưu mã hóa phía server; trang này không bao giờ
          hiển thị Client Secret cũ — để trống nếu không muốn đổi.
        </AlertBanner>

        <form onSubmit={handleSave} className="mt-4 space-y-6">
          {/* ── Cơ bản ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-ink">Cơ bản</h3>
            <TextField
              label="Retailer (tên cửa hàng KiotViet)"
              placeholder="vd: chillcoffee2026"
              value={retailer}
              onChange={(e) => setRetailer(e.target.value)}
              disabled={isSaving}
              error={retailerError}
            />
            <TextField
              label="Client ID"
              placeholder="vd: abc123-def456..."
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={isSaving}
              error={clientIdError}
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <TextField
                  label="Client Secret"
                  type={revealClientSecret ? "text" : "password"}
                  placeholder={clientSecretPlaceholder}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  disabled={isSaving}
                  helper="Để trống = giữ nguyên giá trị đang lưu."
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRevealClientSecret((v) => !v)}
                disabled={isSaving || clientSecret === ""}
              >
                {revealClientSecret ? "Ẩn" : "Hiện"}
              </Button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={isSaving}
                label="Bật kết nối (sync sẽ chạy khi bật)"
              />
            </div>
          </section>

          {/* ── Webhook ── */}
          <section className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink">Webhook</h3>
              {webhookSecret ? (
                <Badge variant="soft" semantic="success">
                  Đã cấu hình
                </Badge>
              ) : (
                <Badge variant="soft" semantic="neutral">
                  Chưa cấu hình
                </Badge>
              )}
            </div>
            {webhookSecret ? (
              <div className="space-y-2">
                <label className="text-xs font-medium text-ink-2">
                  Webhook URL (dán vào KiotViet → Thiết lập kết nối API)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={webhookUrl}
                    type={revealWebhookSecret ? "text" : "password"}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 h-10 px-3 rounded-sm bg-surface-muted border border-border text-xs text-ink font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRevealWebhookSecret((v) => !v)}
                  >
                    {revealWebhookSecret ? "Ẩn" : "Hiện"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={handleCopyWebhookUrl}>
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Sinh secret mới sẽ làm URL cũ vô hiệu. Hãy cập nhật webhook ở KiotViet
                  ngay sau khi sinh lại.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted">
                Sinh secret để tạo một endpoint webhook duy nhất cho cửa hàng này.
                KiotViet sẽ POST cập nhật sản phẩm / tồn kho / hóa đơn về URL đó.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={handleGenerateWebhook}
                loading={isWebhookBusy}
                disabled={isWebhookBusy}
              >
                {webhookSecret ? "Sinh secret mới" : "Sinh secret"}
              </Button>
              {webhookSecret && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRevokeWebhook}
                  loading={isWebhookBusy}
                  disabled={isWebhookBusy}
                >
                  Thu hồi webhook
                </Button>
              )}
            </div>
          </section>

          {/* ── Nâng cao (collapsed) ── */}
          <details className="pt-2 border-t border-border">
            <summary className="text-sm font-medium text-ink cursor-pointer select-none py-1">
              Nâng cao
            </summary>
            <div className="space-y-3 pt-3">
              <TextField
                label="Token URL"
                value={tokenUrl}
                onChange={(e) => setTokenUrl(e.target.value)}
                disabled={isSaving}
                helper="Mặc định: https://api.fnb.kiotviet.vn/identity/connect/token"
              />
              <TextField
                label="API Base"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                disabled={isSaving}
                helper="Mặc định: https://publicfnb.kiotapi.com"
              />
              <TextField
                label="Scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                disabled={isSaving}
                helper="Mặc định: PublicApi.Access.FNB"
              />
              <TextField
                label="Rate limit (req/giây)"
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                step={1}
                value={String(rateLimit)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setRateLimit(Number.isFinite(n) ? n : 0);
                }}
                disabled={isSaving}
                error={rateLimitError}
                helper="Số nguyên 1–10. Mặc định: 4."
              />
            </div>
          </details>

          {/* ── Actions ── */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="ghost" onClick={refresh} disabled={isSaving}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={isSaving} disabled={isSaving}>
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function composeWebhookUrl(secret: string): string {
  const base =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_URL) ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/$/, "")}/api/kiotviet/webhook/${secret}`;
}
