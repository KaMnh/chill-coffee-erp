"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useSupabase } from "@/hooks/use-supabase";

type Mode = "sign-in" | "sign-up" | "forgot-password";

/**
 * Single-card auth screen with two modes: sign-in vs viewer self-signup.
 * Behavior ports v3 features/auth/login-panel.tsx — only the visuals change.
 *
 * On successful sign-in: router.push("/") — middleware will let it through
 * because Supabase auth cookies are now set.
 *
 * On successful signup: keep user on /login but show a toast — they must
 * wait for owner/manager approval before they can sign in.
 */
export function LoginScreen() {
  const router = useRouter();
  const { signIn, signupViewer } = useAuthSession();
  const supabase = useSupabase();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        await signIn(email, password);
        router.push("/");
      } else if (mode === "sign-up") {
        await signupViewer(email, password, fullName);
        toast({
          semantic: "success",
          title: "Đã gửi yêu cầu",
          message: "Quản lý sẽ duyệt tài khoản viewer trước khi bạn dùng được.",
        });
        setMode("sign-in");
      } else {
        // forgot-password: always show neutral message (no account enumeration)
        if (supabase) {
          await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/reset`,
          });
        }
        toast({
          semantic: "info",
          title: "Kiểm tra hộp thư",
          message: "Nếu email tồn tại, chúng tôi đã gửi link đặt lại mật khẩu.",
        });
        setMode("sign-in");
      }
    } catch {
      // For forgot-password: swallow and still show neutral message
      if (mode === "forgot-password") {
        toast({
          semantic: "info",
          title: "Kiểm tra hộp thư",
          message: "Nếu email tồn tại, chúng tôi đã gửi link đặt lại mật khẩu.",
        });
        setMode("sign-in");
      } else {
        setError("Có lỗi xảy ra. Thử lại.");
      }
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
                Trạm vận hành quán
              </h1>
            </div>
          </div>

          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isBusy}
              placeholder="owner@chill.local"
            />
            {mode !== "forgot-password" && (
              <TextField
                label="Mật khẩu"
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isBusy}
                placeholder="••••••••"
              />
            )}
            {mode === "sign-up" && (
              <TextField
                label="Họ và tên"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                disabled={isBusy}
                placeholder="Ví dụ: Nguyễn Văn A"
              />
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={isBusy}
              className="w-full"
            >
              {mode === "sign-in"
                ? "Đăng nhập"
                : mode === "sign-up"
                  ? "Gửi yêu cầu đăng ký"
                  : "Gửi link đặt lại"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted space-y-2">
            {mode === "sign-in" && (
              <>
                <div>
                  <button
                    type="button"
                    className="text-ink underline-offset-4 hover:underline"
                    onClick={() => {
                      setMode("forgot-password");
                      setError(null);
                    }}
                  >
                    Quên mật khẩu?
                  </button>
                </div>
                <div>
                  <button
                    type="button"
                    className="text-ink underline-offset-4 hover:underline"
                    onClick={() => {
                      setMode("sign-up");
                      setError(null);
                    }}
                  >
                    Chưa có tài khoản? Đăng ký viewer
                  </button>
                </div>
              </>
            )}
            {mode !== "sign-in" && (
              <button
                type="button"
                className="text-ink underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("sign-in");
                  setError(null);
                }}
              >
                Quay lại đăng nhập
              </button>
            )}
          </div>
        </Reveal>
      </Card>
    </main>
  );
}
