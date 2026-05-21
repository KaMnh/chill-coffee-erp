"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import { useShiftsQuery } from "@/hooks/queries";

interface HandoverShiftsSummaryProps {
  businessDate: string;
  disabled: boolean;
}

/**
 * Active-shifts summary card. Read-only — no mutations.
 *
 * Counts shift assignments where status === "checked_in" for this date.
 * Surfaces a reminder to check-out all staff before completing handover.
 *
 * If shifts query errors or returns no data, gracefully falls back to a
 * static reminder text without breaking the page.
 */
export function HandoverShiftsSummary({
  businessDate,
  disabled
}: HandoverShiftsSummaryProps) {
  const supabase = useSupabase();
  const shiftsQuery = useShiftsQuery(supabase, businessDate, !disabled);

  const activeCount = (shiftsQuery.data ?? []).filter(
    (s) => s.status === "checked_in"
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nhân viên trong ca</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {shiftsQuery.isLoading ? (
          <div className="flex justify-center py-4"><Spinner size={24} /></div>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-3xl font-bold text-ink tabular-nums">
                {activeCount}
              </span>
              <span className="text-sm text-muted">
                {activeCount === 0
                  ? "Tất cả đã check-out"
                  : "nhân viên chưa check-out"}
              </span>
            </div>
            {activeCount > 0 && (
              <AlertBanner variant="warning">
                Còn {activeCount} nhân viên đang trong ca. Hãy check-out tất cả
                ở module &quot;Ca &amp; lương&quot; trước khi hoàn tất bàn giao.
              </AlertBanner>
            )}
            {activeCount === 0 && shiftsQuery.data && shiftsQuery.data.length > 0 && (
              <Badge variant="soft" semantic="success">
                Sẵn sàng bàn giao
              </Badge>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
