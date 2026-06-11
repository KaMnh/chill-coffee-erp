"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Reveal } from "@/components/ui/reveal";

interface MobileLoginViewProps {
  onLogin(): void;
}

/**
 * Đăng nhập — full-screen 1 cột, ô lớn (h-12, text-base ≥16px chống
 * auto-zoom iOS), CTA lớn ghim đáy (thumb zone), type=email +
 * autoComplete=current-password, autofocus email.
 */
export function MobileLoginView({ onLogin }: MobileLoginViewProps) {
  const [email, setEmail] = useState("owner@chill.local");
  const [password, setPassword] = useState("••••••••");

  return (
    <div
      className="flex flex-col h-full px-6"
      style={{ paddingTop: "calc(var(--pv-safe-top) + 1rem)", paddingBottom: "calc(var(--pv-safe-bottom) + 1rem)" }}
    >
      <Reveal stagger className="flex-1 flex flex-col justify-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/chill-logo.png"
            alt="Chill Coffee Garden"
            width={72}
            height={72}
            className="rounded-2xl shadow-raised"
          />
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-muted">Chill Manager v4</p>
            <h1 className="font-display text-2xl font-bold text-ink mt-1">Trạm vận hành quán</h1>
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onLogin();
          }}
        >
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="owner@chill.local"
            className="h-12 text-base"
          />
          <TextField
            label="Mật khẩu"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="h-12 text-base"
          />
        </form>

        <button type="button" className="text-sm text-ink underline-offset-4 hover:underline mx-auto">
          Chưa có tài khoản? Đăng ký viewer
        </button>
      </Reveal>

      {/* CTA ghim đáy — thumb zone */}
      <Button size="lg" className="w-full shrink-0" onClick={onLogin}>
        Đăng nhập
      </Button>
    </div>
  );
}
