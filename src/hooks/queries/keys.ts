/**
 * Centralised query keys for TanStack Query.
 * Using a factory keeps invalidation predictable: pass the same args
 * to invalidateQueries to refetch.
 */
export const queryKeys = {
  account: () => ["account"] as const,
  appSettings: () => ["app-settings"] as const,
  settingsAccounts: () => ["settings-accounts"] as const,
  categories: () => ["expense-categories"] as const,
  templates: () => ["expense-templates"] as const,
  employees: () => ["employees"] as const,
  dashboard: (businessDate: string) => ["dashboard", businessDate] as const,
  shifts: (businessDate: string) => ["shifts", businessDate] as const,
  payroll: (businessDate: string) => ["payroll", businessDate] as const,
  reports: (businessDate: string) => ["reports", businessDate] as const,
  cashOpening: (businessDate: string) => ["cash-opening", businessDate] as const,
  cashCounts: (businessDate: string) => ["cash-counts", businessDate] as const,
  handover: (businessDate: string) => ["handover", businessDate] as const,
  safeBalance: () => ["safe", "balance"] as const,
  safeTransactions: (filter?: { from?: string; to?: string; type?: string }) =>
    ["safe", "transactions", filter ?? {}] as const,
  safeCounts: () => ["safe", "counts"] as const,
  safeAttachments: (txId: string) => ["safe", "attachments", txId] as const
};
