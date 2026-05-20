import { formatDateTime, formatVND } from "@/lib/format";
import type { CashCloseReport } from "@/lib/types";
import Image from "next/image";

interface PrintableReportProps {
  report: CashCloseReport;
}

/**
 * The actual artifact rendered for print / JPEG export. No data fetching,
 * no callbacks — pure props -> DOM mapping so html-to-image can capture it
 * deterministically.
 *
 * Tokenized vs v3 — class names use Tailwind tokens instead of legacy
 * .printableReport / .reportRows etc. Layout intentionally A4-portrait-ish:
 * 16cm wide max, generous padding, consistent type scale.
 */
export function PrintableReport({ report }: PrintableReportProps) {
  const denominationRows = Object.entries(report.denominations_json ?? {})
    .map(([d, c]) => ({ denomination: Number(d), count: Number(c) }))
    .filter((r) => r.denomination > 0)
    .sort((a, b) => b.denomination - a.denomination);

  return (
    <article className="mx-auto w-full max-w-[16cm] rounded-lg border border-border bg-surface p-6 font-sans text-ink">
      <header className="flex items-start gap-4 border-b border-border pb-4">
        <Image
          src="/chill-logo.png"
          alt="Chill Coffee Garden"
          width={56}
          height={56}
          className="rounded-2xl"
        />
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Chill Coffee Garden
          </p>
          <h1 className="font-display text-xl">Báo cáo chốt két</h1>
          <p className="text-sm text-muted">
            {report.business_date} · {formatDateTime(report.closed_at)}
          </p>
        </div>
      </header>

      <div className="mt-4 flex items-center justify-between text-sm">
        <strong className="text-ink">
          {report.report_status === "final" ? "Đã chốt" : report.report_status}
        </strong>
        <span className="text-muted">
          Snapshot POS: {formatDateTime(report.sync_snapshot_at)}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="Tổng POS" value={formatVND(report.pos_total ?? report.pos_cash_total)} />
        <Row label="POS tiền mặt" value={formatVND(report.pos_cash_total)} />
        <Row label="POS không tiền mặt" value={formatVND(report.pos_non_cash_total ?? 0)} />
        <Row label="Tiền đầu ngày" value={formatVND(report.opening_cash)} />
        <Row label="Thực đếm trong két" value={formatVND(report.physical_cash)} />
        <Row label="Chuyển khoản đã nhận" value={formatVND(report.bank_transfer_confirmed ?? 0)} />
        <Row label="Chi phí cash" value={formatVND(report.expense_cash_total)} />
        <Row label="Lương đã phát" value={formatVND(report.payroll_cash_total)} />
        <Row label="Tổng đối soát" value={formatVND(report.reconciliation_total ?? report.theory_cash)} />
        <Row label="Chênh lệch" value={formatVND(report.difference)} highlight />
        <Row label="Để lại ngày mai" value={formatVND(report.leave_for_next_day ?? 0)} />
        <Row label="Nạp sổ quỹ" value={formatVND(report.safe_deposit_amount ?? 0)} />
      </dl>

      <h3 className="mt-6 mb-2 font-display text-base">Mệnh giá</h3>
      {denominationRows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">
          Chưa có dữ liệu mệnh giá
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 font-medium">Mệnh giá</th>
              <th className="py-2 font-medium">Số tờ</th>
              <th className="py-2 font-medium text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {denominationRows.map((r) => (
              <tr key={r.denomination} className="border-b border-border">
                <td className="py-2">{formatVND(r.denomination)}</td>
                <td className="py-2">{r.count}</td>
                <td className="py-2 text-right font-display">
                  {formatVND(r.denomination * r.count)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-4 text-sm text-muted">
        Ghi chú: {report.note || "Không có"}
      </p>

      <footer className="mt-8 grid grid-cols-2 gap-6 text-center text-sm">
        <div className="border-t border-border pt-4">Người chốt</div>
        <div className="border-t border-border pt-4">Quản lý</div>
      </footer>
    </article>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd
        className={
          "text-right font-display " +
          (highlight ? "text-base text-ink" : "text-sm text-ink")
        }
      >
        {value}
      </dd>
    </>
  );
}
