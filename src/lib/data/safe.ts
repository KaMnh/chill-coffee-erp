import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SafeAttachment,
  SafeBalances,
  SafeCount,
  SafeFund,
  SafeTransaction,
  SafeTransactionType,
  SafeWithdrawCategory
} from "@/lib/types";
import { toAppError, unwrapJson } from "./_common";

const SAFE_RECEIPTS_BUCKET = "safe-receipts";
export const SAFE_ATTACHMENT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const SAFE_ATTACHMENT_MAX_COUNT = 5;
export const SAFE_ATTACHMENT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif"
] as const;

/**
 * 3 số dư sổ quỹ: quỹ tiền mặt, quỹ chuyển khoản, và tổng. Owner + manager xem
 * được (manager để hiển thị status, KHÔNG có quyền thao tác).
 */
export async function loadSafeBalances(supabase: SupabaseClient): Promise<SafeBalances> {
  const { data, error } = await supabase.rpc("safe_balances_now");
  if (error) throw toAppError(error, "Không tải được số dư sổ quỹ.");
  const o = (data ?? {}) as Partial<SafeBalances>;
  return {
    cash: Number(o.cash ?? 0),
    transfer: Number(o.transfer ?? 0),
    total: Number(o.total ?? 0)
  };
}

/**
 * List transactions với optional filter date range + type.
 * Server-side đã sort desc theo occurred_at.
 */
export async function loadSafeTransactions(
  supabase: SupabaseClient,
  options: {
    fromDate?: string;
    toDate?: string;
    type?: SafeTransactionType;
  } = {}
): Promise<SafeTransaction[]> {
  const { data, error } = await supabase.rpc("safe_list_transactions", {
    p_from: options.fromDate ?? null,
    p_to: options.toDate ?? null,
    p_type: options.type ?? null
  });
  if (error) throw toAppError(error, "Không tải được lịch sử sổ quỹ.");
  return unwrapJson<SafeTransaction[]>(data, []) ?? [];
}

/** Tạo row initial_setup. Chỉ chạy được 1 lần khi safe chưa có transaction. */
export async function setupSafeInitial(
  supabase: SupabaseClient,
  cash: number,
  transfer: number,
  note?: string
) {
  const { data, error } = await supabase.rpc("safe_setup_initial", {
    p_cash: cash,
    p_transfer: transfer,
    p_note: note ?? null
  });
  if (error) throw toAppError(error, "Không thiết lập được sổ quỹ.");
  return data as {
    cash_id: string | null;
    transfer_id: string | null;
    cash: number;
    transfer: number;
    balance: number;
  };
}

/**
 * Rút sổ quỹ cho mục đích khác — tách 2 quỹ (CK + tiền mặt) + chỉnh được ngày.
 * occurredAt (ISO) là nhãn ngày; số dư giảm ngay (cơ sở created_at).
 */
export async function withdrawSafeOther(
  supabase: SupabaseClient,
  payload: {
    cashAmount: number;
    transferAmount: number;
    category: SafeWithdrawCategory;
    description?: string;
    occurredAt?: string;
  }
) {
  const { data, error } = await supabase.rpc("safe_withdraw_other", {
    p_cash_amount: payload.cashAmount,
    p_transfer_amount: payload.transferAmount,
    p_category: payload.category,
    p_description: payload.description ?? null,
    p_occurred_at: payload.occurredAt ?? null
  });
  if (error) throw toAppError(error, "Không rút được sổ quỹ.");
  return data as {
    cash_id: string | null;
    transfer_id: string | null;
    cash_balance_after: number | null;
    transfer_balance_after: number | null;
    total: number;
    expense_id: string;
  };
}

/** Adjust số dư MỘT quỹ (cash | transfer) khi lệch. Note bắt buộc >= 5 ký tự. */
export async function adjustSafe(
  supabase: SupabaseClient,
  payload: { fund: SafeFund; newBalance: number; note: string }
) {
  const { data, error } = await supabase.rpc("safe_adjust", {
    p_fund: payload.fund,
    p_new_balance: payload.newBalance,
    p_note: payload.note
  });
  if (error) throw toAppError(error, "Không điều chỉnh được sổ quỹ.");
  return data as { id: string; fund: SafeFund; balance_after: number; difference: number };
}

/** Snapshot mệnh giá (KHÔNG auto adjust balance). */
export async function countSafe(
  supabase: SupabaseClient,
  payload: { denominations: Record<string, number>; note?: string }
) {
  const denoms = Object.fromEntries(
    Object.entries(payload.denominations).map(([k, v]) => [String(k), Math.max(0, Number(v) || 0)])
  );
  const { data, error } = await supabase.rpc("safe_count", {
    p_denominations_json: denoms,
    p_note: payload.note ?? null
  });
  if (error) throw toAppError(error, "Không lưu được lần đếm sổ quỹ.");
  return data as {
    id: string;
    total_physical: number;
    expected_balance: number;
    difference: number;
  };
}

/** List safe_counts trực tiếp (qua RLS — owner only). */
export async function loadSafeCounts(supabase: SupabaseClient, limit = 20): Promise<SafeCount[]> {
  const { data, error } = await supabase
    .from("safe_counts")
    .select("id, counted_at, denominations_json, total_physical, expected_balance, difference, note, counted_by, created_at")
    .order("counted_at", { ascending: false })
    .limit(limit);
  if (error) throw toAppError(error, "Không tải được lịch sử đếm sổ quỹ.");
  return (data ?? []) as SafeCount[];
}

// =============================================================================
// Safe attachments — Phase 1: upload + list + delete + signed URL.
// Phase 2 sẽ thêm n8n integration (read processed_at + extracted_data).
// =============================================================================

/**
 * Upload 1 file ảnh hóa đơn cho 1 transaction.
 * Flow: storage.upload → safe_attachment_create RPC. Nếu RPC fail, rollback
 * storage object để không có orphan file.
 *
 * Storage path format: `{transaction_id}/{uuid}.{ext}` — n8n Phase 2 phụ thuộc.
 */
export async function uploadSafeAttachment(
  supabase: SupabaseClient,
  transactionId: string,
  file: File
): Promise<{ attachment_id: string; storage_path: string }> {
  // Client-side defense-in-depth (DB CHECK + Storage bucket also enforce).
  if (file.size > SAFE_ATTACHMENT_MAX_FILE_SIZE) {
    throw new Error(`File "${file.name}" vượt 5 MB.`);
  }
  if (!(SAFE_ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    throw new Error(`File "${file.name}" không phải JPG/PNG/HEIC.`);
  }

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${transactionId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(SAFE_RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw toAppError(upErr, `Không upload được "${file.name}".`);

  const { data, error } = await supabase.rpc("safe_attachment_create", {
    p_payload: {
      transaction_id: transactionId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      file_size: file.size
    }
  });
  if (error) {
    // Rollback storage upload nếu metadata insert fail (RLS, trigger 5-file cap, ...)
    await supabase.storage.from(SAFE_RECEIPTS_BUCKET).remove([path]);
    throw toAppError(error, `Không lưu được metadata cho "${file.name}".`);
  }
  return {
    attachment_id: (data as { attachment_id: string }).attachment_id,
    storage_path: path
  };
}

/** List attachments cho 1 transaction (RPC owner-only). */
export async function loadSafeAttachments(
  supabase: SupabaseClient,
  transactionId: string
): Promise<SafeAttachment[]> {
  const { data, error } = await supabase.rpc("safe_list_attachments", {
    p_transaction_id: transactionId
  });
  if (error) throw toAppError(error, "Không tải được danh sách hóa đơn.");
  return unwrapJson<SafeAttachment[]>(data, []) ?? [];
}

/**
 * Xóa 1 attachment: storage object trước, rồi metadata. Nếu storage xóa fail,
 * abort để không có DB row mồ côi pointing tới file đã chết.
 */
export async function deleteSafeAttachment(
  supabase: SupabaseClient,
  attachmentId: string,
  storagePath: string
): Promise<void> {
  const { error: storageErr } = await supabase.storage
    .from(SAFE_RECEIPTS_BUCKET)
    .remove([storagePath]);
  if (storageErr) throw toAppError(storageErr, "Không xóa được file ảnh.");

  const { error } = await supabase.rpc("safe_attachment_delete", {
    p_attachment_id: attachmentId
  });
  if (error) throw toAppError(error, "Không xóa được metadata hóa đơn.");
}

/** Tạo signed URL 1-hour cho preview / download (private bucket). */
export async function getSafeAttachmentSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SAFE_RECEIPTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) throw toAppError(error, "Không tạo được URL xem ảnh.");
  return data.signedUrl;
}

// =============================================================================
// Nhập nguyên liệu từ sổ quỹ (F1+F2)
// =============================================================================

/**
 * MỘT giao dịch atomic: trừ sổ quỹ (tách CK + tiền mặt) + đẩy tồn kho + cập
 * nhật last_unit_price. Tổng được server tính lại từ lines (không tin client);
 * cashAmount + transferAmount phải khớp tổng đó.
 */
export async function safePurchaseInventory(
  supabase: SupabaseClient,
  payload: {
    cashAmount: number;
    transferAmount: number;
    lines: ReadonlyArray<{
      ingredient_id: string;
      quantity: number;
      unit_price: number;
      sync_price: boolean;
    }>;
    description?: string;
    occurredAt?: string;
  }
) {
  const { data, error } = await supabase.rpc("safe_purchase_inventory", {
    p_cash_amount: payload.cashAmount,
    p_transfer_amount: payload.transferAmount,
    p_lines: payload.lines,
    p_description: payload.description ?? null,
    p_occurred_at: payload.occurredAt ?? null
  });
  if (error) throw toAppError(error, "Không nhập được nguyên liệu từ sổ quỹ.");
  return data as {
    cash_id: string | null;
    transfer_id: string | null;
    cash_balance_after: number | null;
    transfer_balance_after: number | null;
    total: number;
    movement_ids: string[];
  };
}
