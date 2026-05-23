"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useRejectSignup } from "@/hooks/mutations/use-settings-mutations";
import type { SignupRequest } from "@/lib/types";
import { ApproveSignupModal } from "./approve-signup-modal";

interface SignupRequestsCardProps {
  requests: SignupRequest[];
}

/**
 * Card listing signup_requests in status='pending_approval'.
 *
 * Render-rule: if `requests.length === 0` the card returns null so the
 * Settings page doesn't show a noisy empty card. (Conditional render is
 * preferred to an EmptyState here because the absence of pending requests
 * is the common case.)
 */
export function SignupRequestsCard({ requests }: SignupRequestsCardProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const rejectM = useRejectSignup(supabase);

  const [approving, setApproving] = useState<SignupRequest | null>(null);
  const [rejecting, setRejecting] = useState<SignupRequest | null>(null);

  if (requests.length === 0) return null;

  async function handleReject() {
    if (!rejecting) return;
    try {
      await rejectM.mutateAsync({ id: rejecting.id });
      toast({ semantic: "success", message: "Đã từ chối đơn." });
      setRejecting(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Từ chối thất bại."
      });
    }
  }

  function formatRequestedAt(iso: string): string {
    try {
      return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Đơn đăng ký chờ duyệt</CardTitle>
            <p className="mt-1 text-xs text-muted">
              {requests.length} đơn đang chờ — viewer đã tự đăng ký ở màn
              đăng nhập, cần owner/manager gán role.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted">
                    Email
                  </th>
                  <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Họ tên
                  </th>
                  <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Gửi lúc
                  </th>
                  <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Hành động
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 text-sm text-ink">{req.email}</td>
                    <td className="py-3 px-2 text-sm text-ink">
                      {req.name ?? <span className="text-muted">(không có)</span>}
                    </td>
                    <td className="py-3 px-2 text-xs text-muted">
                      {formatRequestedAt(req.requested_at)}
                    </td>
                    <td className="py-3 pl-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={() => setApproving(req)}
                        >
                          Duyệt
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejecting(req)}
                        >
                          Từ chối
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <ApproveSignupModal
        open={approving !== null}
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
        request={approving}
      />

      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
      >
        <ModalContent>
          <ModalTitle>Từ chối đơn đăng ký?</ModalTitle>
          <ModalDescription>
            Đơn của {rejecting?.email} sẽ chuyển trạng thái "rejected". Auth
            user đã tạo trong Supabase giữ nguyên — họ có thể đăng nhập
            nhưng sẽ luôn thấy màn "Tài khoản chờ duyệt".
          </ModalDescription>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRejecting(null)}
              disabled={rejectM.isPending}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              loading={rejectM.isPending}
            >
              Từ chối
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>
    </>
  );
}
