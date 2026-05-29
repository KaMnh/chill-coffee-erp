/**
 * KiotViet FNB API types — ported from standalone Kiotviet sync project.
 * Reference: https://www.kiotviet.vn/public-api-fnb/
 */

export type KvCredentials = {
  client_id: string;
  client_secret: string;
  retailer: string;
  token_url: string;
  api_base: string;
  scope: string;
  rate_limit_per_sec: number;
  is_active: boolean;
  /** Secret nhúng vào URL webhook KiotViet sẽ POST đến.
   *  vd: https://chill.your-domain.com/api/kiotviet/webhook/<webhook_secret>
   *  Generate ngẫu nhiên 32+ ký tự. Empty = webhook bị từ chối. */
  webhook_secret: string;
  /** Default sync window in days (1..31). Applies to manual sync + stale
   *  auto-load: a windowed sync pulls [anchor-(N-1) … anchor]. Default 1
   *  (single day = legacy behavior). */
  sync_window_days: number;
};

export interface KvTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface KvListResponse<T> {
  total: number;
  pageSize: number;
  data: T[];
  removedIds?: number[];
}

export interface KvInvoice {
  id: number;
  uuid?: string;
  code: string;
  purchaseDate: string;
  branchId: number;
  branchName?: string;
  soldById?: number;
  soldByName?: string;
  customerId?: number;
  customerCode?: string;
  customerName?: string;
  total: number;
  totalPayment: number;
  discount?: number;
  discountRatio?: number;
  status: number;
  statusValue?: string;
  description?: string;
  usingCod?: boolean;
  modifiedDate?: string;
  createdDate?: string;
  invoiceDetails?: KvInvoiceDetail[];
  payments?: KvPayment[];
  [key: string]: unknown;
}

export interface KvInvoiceDetail {
  productId: number;
  productCode?: string;
  productName?: string;
  categoryId?: number;
  categoryName?: string;
  quantity: number;
  price: number;
  discount?: number;
  discountRatio?: number;
  subTotal?: number;
  note?: string;
  [key: string]: unknown;
}

export interface KvPayment {
  id: number;
  code?: string;
  amount: number;
  method?: string;
  status?: number;
  statusValue?: string;
  transDate?: string;
  bankAccount?: string;
  accountId?: number;
}

export interface KvProduct {
  id: number;
  code: string;
  name: string;
  fullName?: string;
  categoryId?: number;
  categoryName?: string;
  basePrice?: number;
  isActive?: boolean;
  modifiedDate?: string;
  [key: string]: unknown;
}

export interface KvBranch {
  id: number;
  branchName: string;
  address?: string;
  contactNumber?: string;
  [key: string]: unknown;
}

export interface KvWebhookNotification {
  Action: string;
  Data: Array<{ Id: number; Code?: string; [key: string]: unknown }>;
}

export interface KvWebhookPayload {
  Id?: string;
  Attempt?: number;
  Notifications: KvWebhookNotification[];
}

/** Default credentials placeholder — overridden by app_settings row. */
export const DEFAULT_KV_CREDENTIALS: KvCredentials = {
  client_id: "",
  client_secret: "",
  retailer: "",
  token_url: "https://api.fnb.kiotviet.vn/identity/connect/token",
  api_base: "https://publicfnb.kiotapi.com",
  scope: "PublicApi.Access.FNB",
  rate_limit_per_sec: 4,
  is_active: false,
  webhook_secret: "",
  sync_window_days: 1
};
