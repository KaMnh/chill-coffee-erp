import type { Metadata } from "next";
import { PreviewShell } from "./_components/preview-shell";

/**
 * /mobile — preview mockup điện thoại (route group (preview), không nằm
 * trong nav app chính). Mock data thuần client, KHÔNG gọi DB/API.
 */
export const metadata: Metadata = {
  title: "Mobile preview — Chill Coffee ERP",
  description: "Mockup điện thoại cho 11 view + đăng nhập của Chill Coffee ERP — mock data, không gọi API.",
  robots: { index: false, follow: false },
};

export default function MobilePreviewPage() {
  return <PreviewShell />;
}
