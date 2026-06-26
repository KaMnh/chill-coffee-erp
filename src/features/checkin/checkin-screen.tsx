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

const fmtVN = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });

export function CheckinScreen() {
  const supabase = useSupabase();
  const qc = useQueryClient();
  const statusQ = useMyCheckinStatusQuery(supabase, true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);

  async function onCheckin() {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeader(supabase);
      const r = await submitCheckin(headers);
      setResult(r);
      qc.invalidateQueries({ queryKey: queryKeys.myCheckinStatus() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chấm công được.");
    } finally {
      setBusy(false);
    }
  }

  const name = statusQ.data?.employee_name;
  const alreadyToday = statusQ.data?.checked_in_today;

  if (result) {
    return (
      <main className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border p-8 text-center space-y-3">
          <div aria-hidden className="text-5xl">
            ✓
          </div>
          <h1 className="text-xl font-semibold">
            {result.already_checked_in ? "Bạn đã vào ca hôm nay rồi" : "Vào ca thành công"}
          </h1>
          <p className="text-lg font-medium">{result.employee_name}</p>
          <p className="text-sm text-muted">{fmtVN(result.check_in_at)}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border p-8 space-y-5 text-center">
        <h1 className="text-xl font-semibold">Chấm công</h1>
        {name && <p className="text-sm text-muted">Xin chào, {name}</p>}
        {error && (
          <AlertBanner variant="danger" onClose={() => setError(null)}>
            {error}
          </AlertBanner>
        )}
        {alreadyToday ? (
          <p className="text-emerald-600 font-medium">Bạn đã vào ca hôm nay.</p>
        ) : (
          <Button
            variant="primary"
            loading={busy}
            onClick={onCheckin}
            className="w-full py-3 text-lg"
          >
            Vào ca
          </Button>
        )}
        <p className="text-xs text-muted">
          Khi chấm công, hệ thống ghi lại thời điểm, IP và thiết bị của bạn.
        </p>
      </div>
    </main>
  );
}
