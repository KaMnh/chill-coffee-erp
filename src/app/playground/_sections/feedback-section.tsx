"use client";

import { useState } from "react";
import { Modal, ModalTrigger, ModalContent, ModalTitle, ModalDescription, ModalActions, ModalClose } from "@/components/ui/modal";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export function FeedbackSection() {
  const [progress, setProgress] = useState(30);
  const { toast } = useToast();

  return (
    <div className="space-y-8">
      <h2 className="font-display text-3xl font-bold text-ink mb-2">Feedback</h2>
      <SubSection title="Modal">
        <Modal>
          <ModalTrigger asChild>
            <Button>Open Modal</Button>
          </ModalTrigger>
          <ModalContent>
            <ModalTitle>Xác nhận xóa</ModalTitle>
            <ModalDescription>Hành động này không thể hoàn tác.</ModalDescription>
            <ModalActions>
              <ModalClose asChild>
                <Button variant="secondary">Hủy</Button>
              </ModalClose>
              <Button variant="destructive">Xóa</Button>
            </ModalActions>
          </ModalContent>
        </Modal>
      </SubSection>
      <SubSection title="Toast (click button trigger)">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => toast({ semantic: "info", message: "Thông báo info" })}>Info</Button>
          <Button onClick={() => toast({ semantic: "success", title: "Thành công", message: "Đã lưu" })}>Success</Button>
          <Button onClick={() => toast({ semantic: "warning", message: "Cảnh báo: kiểm tra lại" })}>Warning</Button>
          <Button onClick={() => toast({ semantic: "danger", message: "Có lỗi xảy ra" })}>Danger</Button>
        </div>
      </SubSection>
      <SubSection title="AlertBanner variants">
        <div className="space-y-2">
          <AlertBanner variant="info" title="Thông tin:">Server đang sync KiotViet.</AlertBanner>
          <AlertBanner variant="success" title="Thành công:">Báo cáo đã lưu.</AlertBanner>
          <AlertBanner variant="warning" title="Lưu ý:" onClose={() => {}}>Sắp hết hàng cà phê arabica.</AlertBanner>
          <AlertBanner variant="danger" title="Lỗi:">Không thể kết nối Supabase.</AlertBanner>
        </div>
      </SubSection>
      <SubSection title="ProgressBar">
        <div className="space-y-3">
          <ProgressBar value={progress} showLabel />
          <ProgressBar value={75} />
          <ProgressBar />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setProgress((p) => Math.max(0, p - 10))}>-10%</Button>
            <Button size="sm" onClick={() => setProgress((p) => Math.min(100, p + 10))}>+10%</Button>
          </div>
        </div>
      </SubSection>
      <SubSection title="Spinner sizes">
        <div className="flex items-center gap-4 text-ink">
          <Spinner size={16} />
          <Spinner size={24} />
          <Spinner size={32} />
        </div>
      </SubSection>
      <SubSection title="Skeleton">
        <div className="space-y-2 max-w-md">
          <Skeleton width="100%" height="1rem" />
          <Skeleton width="80%" height="1rem" />
          <Skeleton width="60%" height="1rem" />
          <div className="flex items-center gap-3 mt-4">
            <Skeleton width="2.5rem" height="2.5rem" rounded="full" />
            <Skeleton width="12rem" height="1rem" />
          </div>
        </div>
      </SubSection>
      <SubSection title="EmptyState">
        <EmptyState
          icon="info"
          title="Chưa có dữ liệu"
          subtitle="Tạo bản ghi đầu tiên để bắt đầu."
          action={<Button size="sm">Thêm mới</Button>}
          dashedBorder
        />
      </SubSection>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wider">{title}</h3>
      <div className="bg-surface rounded-lg shadow-raised p-6">{children}</div>
    </div>
  );
}
