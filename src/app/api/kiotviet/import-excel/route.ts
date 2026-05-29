/**
 * POST /api/kiotviet/import-excel — owner-only manual import of a KiotViet
 * "Chi tiết hóa đơn" .xlsx to fix drifted invoice dates.
 *
 * multipart/form-data: file (.xlsx) + commit ("true" | "false").
 *   commit=false → dry-run preview (counts + date corrections, no writes)
 *   commit=true  → apply (upsert by invoice_code + backfill)
 *
 * Calls the SECURITY DEFINER RPC via the caller's JWT so app_role()='owner'
 * resolves inside the function (route also gates with requireAuth(['owner'])).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getUserClient, requireAuth } from "@/lib/supabase/server";
import { parseWorkbookToRows, buildImportPayloadFromRows } from "@/lib/kiotviet/excel-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function fail(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  try {
    await requireAuth(authHeader, ["owner"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return fail(message, code);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Body không hợp lệ (cần multipart/form-data).");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("Thiếu field 'file'.");
  if (!/\.xlsx$/i.test(file.name)) {
    return fail("Chỉ nhận file .xlsx (export 'Chi tiết hóa đơn' từ KiotViet).");
  }
  if (file.size > MAX_FILE_SIZE) {
    return fail(`File quá lớn (tối đa ${MAX_FILE_SIZE / 1024 / 1024}MB).`);
  }
  const commit = form.get("commit") === "true";

  let payload;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await parseWorkbookToRows(buffer);
    payload = buildImportPayloadFromRows(rows, {
      batchId: `excel-${new Date().toISOString()}`,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Không đọc được file Excel.");
  }

  if (payload.orders.length === 0) {
    return fail(
      "Không tìm thấy hóa đơn hợp lệ trong file (kiểm tra cột bắt buộc và trạng thái 'Hoàn thành').",
    );
  }

  try {
    const supabase = getUserClient(authHeader);
    const { data, error } = await supabase.rpc("import_sales_from_excel", {
      p_payload: payload,
      p_commit: commit,
    });
    if (error) return fail(error.message, 500);
    return NextResponse.json({ status: "success", ...(data as object), meta: payload.meta });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Import thất bại.", 500);
  }
}
