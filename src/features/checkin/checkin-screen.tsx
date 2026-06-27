"use client";

import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { useMyCheckinStatusQuery } from "@/hooks/queries/use-my-checkin-status-query";
import { authHeader } from "@/lib/data/accounts";
import { submitCheckin, submitCheckout, type CheckinResult, type CheckoutResult } from "@/lib/data/checkin";
import { queryKeys } from "@/hooks/queries/keys";
import { formatVND } from "@/lib/format";

const fmtVN = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

type Done = { type: "in"; data: CheckinResult } | { type: "out"; data: CheckoutResult };

export function CheckinScreen() {
  const supabase = useSupabase();
  const qc = useQueryClient();
  const statusQ = useMyCheckinStatusQuery(supabase, true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function run(kind: "in" | "out") {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeader(supabase);
      if (kind === "in") setDone({ type: "in", data: await submitCheckin(headers) });
      else setDone({ type: "out", data: await submitCheckout(headers) });
      qc.invalidateQueries({ queryKey: queryKeys.myCheckinStatus() });
    } catch (e) {
      setError(e instanceof Error ? e.message : kind === "in" ? "Không chấm công được." : "Không ra ca được.");
    } finally {
      setBusy(false);
    }
  }

  const name = statusQ.data?.employee_name;
  const inShift = statusQ.data?.checked_in_today;
  const outToday = statusQ.data?.checked_out_today;
  const canSelfCheckout = statusQ.data?.self_checkout_enabled;

  if (done) {
    return (
      <main className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border p-8 text-center space-y-3">
          <div aria-hidden className="text-5xl">✓</div>
          {done.type === "in" ? (
            <>
              <h1 className="text-xl font-semibold">
                {done.data.already_checked_in ? "Bạn đã vào ca hôm nay rồi" : "Vào ca thành công"}
              </h1>
              <p className="text-lg font-medium">{done.data.employee_name}</p>
              <p className="text-sm text-muted">{fmtVN(done.data.check_in_at)}</p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">
                {done.data.already_checked_out ? "Bạn đã ra ca hôm nay rồi" : "Ra ca thành công"}
              </h1>
              <p className="text-lg font-medium">{done.data.employee_name}</p>
              <p className="text-sm text-muted">{fmtVN(done.data.check_out_at)}</p>
              <p className="text-sm">
                Lương lượt này: <strong className="text-ink">{formatVND(done.data.total_pay)}</strong>
              </p>
            </>
          )}
          <Button
            variant="secondary"
            onClick={() => setDone(null)}
            className="w-full"
          >
            {done.type === "out" ? "Vào ca lượt mới" : "Quay lại"}
          </Button>
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

        {!inShift && (
          <>
            {outToday && (
              <p className="text-emerald-600 font-medium">
                Bạn đã ra ca lượt trước — có thể vào ca mới.
              </p>
            )}
            <Button variant="primary" loading={busy} onClick={() => run("in")} className="w-full py-3 text-lg">
              {outToday ? "Vào ca lượt mới" : "Vào ca"}
            </Button>
          </>
        )}

        {inShift && (
          <>
            <p className="text-emerald-600 font-medium">Bạn đang trong ca.</p>
            {canSelfCheckout ? (
              <Button variant="primary" loading={busy} onClick={() => run("out")} className="w-full py-3 text-lg">
                Ra ca
              </Button>
            ) : (
              <p className="text-xs text-muted">Quản lý sẽ chốt ra ca cho bạn.</p>
            )}
          </>
        )}

        <p className="text-xs text-muted">
          Khi chấm công, hệ thống ghi lại thời điểm, IP và thiết bị của bạn.
        </p>
      </div>
    </main>
  );
}
