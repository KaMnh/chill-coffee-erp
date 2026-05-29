"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Modal, ModalContent, ModalTitle, ModalDescription, ModalActions, ModalClose } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  previewExcelImport,
  commitExcelImport,
  type ExcelImportResult,
} from "@/hooks/mutations/use-kiotviet-import-mutations";
import type { UserRole } from "@/lib/types";

interface Props {
  role: UserRole;
  authHeader: string | null;
}

/**
 * Owner-only: import a KiotViet "Chi tiết hóa đơn" .xlsx to fix drifted invoice
 * dates. Two phases — dry-run preview, then confirm + apply (upsert by code).
 */
export function KiotvietExcelImportCard({ role, authHeader }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ExcelImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // General tab is shared with manager; this tool is owner-only.
  if (role !== "owner") return null;

  function reset() {
    setFile(null);
    setPreview(null);
  }

  async function handlePreview() {
    if (!file || !authHeader) return;
    setBusy(true);
    setPreview(null);
    try {
      setPreview(await previewExcelImport(authHeader, file));
    } catch (e) {
      toast({ semantic: "danger", message: e instanceof Error ? e.message : "Xem trước lỗi." });
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!file || !authHeader) return;
    setConfirmOpen(false);
    setBusy(true);
    try {
      const r = await commitExcelImport(authHeader, file);
      toast({
        semantic: "success",
        title: "Import xong",
        message: `${r.orders} hóa đơn (${r.would_update} cập nhật, ${r.would_insert} thêm mới).`,
      });
      qc.invalidateQueries();
      reset();
    } catch (e) {
      toast({ semantic: "danger", message: e instanceof Error ? e.message : "Import lỗi." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Nhập Excel KiotViet (sửa ngày hóa đơn)</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Tải file &quot;Chi tiết hóa đơn&quot; (.xlsx) xuất từ KiotViet để cập nhật lại ngày + số tiền hóa đơn
            (khớp theo Mã hóa đơn). Dùng khi API sync làm lệch ngày thực tế.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <FileUploadField
          accept=".xlsx"
          buttonLabel="Chọn file .xlsx"
          onSelect={(f) => {
            setFile(f);
            setPreview(null);
          }}
          selectedFileName={file?.name ?? null}
          onClear={reset}
          disabled={busy}
        />

        <div className="flex gap-2">
          <Button variant="secondary" onClick={handlePreview} loading={busy} disabled={!file || !authHeader || busy}>
            Xem trước
          </Button>
          {preview && (
            <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={busy}>
              Áp dụng
            </Button>
          )}
        </div>

        {preview && (
          <div className="space-y-3">
            <AlertBanner variant="warning" title="Xem trước (chưa ghi dữ liệu)">
              Sẽ <strong>cập nhật {preview.would_update}</strong> hóa đơn đã có và{" "}
              <strong>thêm mới {preview.would_insert}</strong> hóa đơn
              {preview.meta.skipped_count > 0 ? <> · bỏ qua {preview.meta.skipped_count} (không &quot;Hoàn thành&quot;)</> : null}.
              Thao tác này ghi đè ngày/số tiền/sản phẩm và sẽ tính lại Bảng vận hành, Dòng tiền, Chốt két, Báo cáo.
            </AlertBanner>

            {preview.date_corrections.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1 pr-4">Mã hóa đơn</th>
                      <th className="py-1 pr-4">Ngày cũ</th>
                      <th className="py-1">Ngày mới</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.date_corrections.slice(0, 15).map((d) => (
                      <tr key={d.invoice_code} className="border-t border-border">
                        <td className="py-1 pr-4 tabular-nums">{d.invoice_code}</td>
                        <td className="py-1 pr-4 tabular-nums text-muted">{d.from ?? "— (mới)"}</td>
                        <td className="py-1 tabular-nums font-medium text-ink">{d.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.date_corrections.length > 15 && (
                  <p className="mt-1 text-xs text-muted">… và {preview.date_corrections.length - 15} dòng khác.</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ModalContent>
          <ModalTitle>Áp dụng import?</ModalTitle>
          <ModalDescription>
            Ghi đè {preview?.would_update ?? 0} hóa đơn đã có và thêm {preview?.would_insert ?? 0} hóa đơn mới từ Excel.
            Dữ liệu sales hiện tại của các hóa đơn này sẽ bị thay thế.
          </ModalDescription>
          <ModalActions>
            <ModalClose asChild>
              <Button variant="ghost">Hủy</Button>
            </ModalClose>
            <Button variant="destructive" onClick={handleCommit} loading={busy}>
              Áp dụng ghi đè
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>
    </Card>
  );
}
