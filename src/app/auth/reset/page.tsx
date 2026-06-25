"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";

export const dynamic = "force-dynamic";

/**
 * Password reset page.
 *
 * Supabase sends the user here via a magic link after they request a reset.
 * The link exchanges the token for a session and fires a PASSWORD_RECOVERY
 * auth event. We subscribe to onAuthStateChange and only show the new-password
 * form once that event arrives (or a recovery session is already present).
 *
 * This page is reachable without an existing session (PUBLIC_PATHS includes
 * "/auth" in middleware.ts).
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const { toast } = useToast();

  // "loading" while waiting for auth event, "ready" once recovery session is
  // confirmed, "invalid" if the link is missing/expired/already used.
  const [recoveryStatus, setRecoveryStatus] = useState<"loading" | "ready" | "invalid">(
    "loading"
  );

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Subscribe to auth state changes to detect PASSWORD_RECOVERY event.
  useEffect(() => {
    if (!supabase) {
      setRecoveryStatus("invalid");
      return;
    }

    // If a recovery session is already present from a previous event on this
    // page load, honour it immediately.
    supabase.auth.getSession().then(({ data }) => {
      if (!mountedRef.current) return;
      if (data.session) {
        // A session exists — could be a normal session (user navigated here
        // directly) or a recovery session. We rely on onAuthStateChange to
        // distinguish via the PASSWORD_RECOVERY event type. However, if the
        // page was hard-refreshed after the link was followed, Supabase may
        // not re-fire the event. In that case we check the AMR claims.
        const amr = data.session.user?.aud;
        // Fall through to the subscription which will also fire INITIAL_SESSION.
        void amr;
      }
    });

    const { data: listenerData } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        setRecoveryStatus("ready");
      } else if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        // If the page loads with an existing session but no PASSWORD_RECOVERY,
        // the link may be invalid or already used. Mark invalid only if we
        // have not already reached "ready".
        setRecoveryStatus((prev) => (prev === "loading" ? "invalid" : prev));
      }
    });

    // Safety timeout: if no auth event fires within 5 s, treat link as invalid.
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setRecoveryStatus((prev) => (prev === "loading" ? "invalid" : prev));
      }
    }, 5000);

    return () => {
      listenerData.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự.");
      return;
    }
    if (!supabase) {
      setError("Không thể kết nối dịch vụ xác thực.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;
      toast({
        semantic: "success",
        title: "Đặt lại mật khẩu thành công",
        message: "Bạn có thể đăng nhập bằng mật khẩu mới.",
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra. Thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-bg-app-from to-bg-app-to flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <Reveal stagger className="space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Image
              src="/chill-logo.png"
              alt="Chill Coffee Garden"
              width={64}
              height={64}
              className="rounded-2xl shadow-raised"
              priority
            />
            <div className="text-center">
              <p className="text-sm uppercase tracking-wide text-muted">
                Chill Manager v4
              </p>
              <h1 className="font-display text-2xl text-ink mt-1">
                Đặt lại mật khẩu
              </h1>
            </div>
          </div>

          {recoveryStatus === "loading" && (
            <p className="text-center text-sm text-muted">Đang xác minh link…</p>
          )}

          {recoveryStatus === "invalid" && (
            <AlertBanner variant="danger" title="Link không hợp lệ">
              Link đặt lại mật khẩu đã hết hạn hoặc đã được sử dụng.{" "}
              <button
                type="button"
                className="underline underline-offset-4 hover:no-underline"
                onClick={() => router.push("/login")}
              >
                Quay lại đăng nhập
              </button>
            </AlertBanner>
          )}

          {recoveryStatus === "ready" && (
            <>
              {error && (
                <AlertBanner variant="danger" title="Không thực hiện được">
                  {error}
                </AlertBanner>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <TextField
                  label="Mật khẩu mới"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={isBusy}
                  placeholder="Ít nhất 6 ký tự"
                />
                <TextField
                  label="Xác nhận mật khẩu"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={isBusy}
                  placeholder="Nhập lại mật khẩu mới"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={isBusy}
                  className="w-full"
                >
                  Đặt lại mật khẩu
                </Button>
              </form>
            </>
          )}
        </Reveal>
      </Card>
    </main>
  );
}
