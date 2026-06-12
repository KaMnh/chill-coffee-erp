/**
 * Export a DOM node as a JPEG download via html-to-image.
 *
 * Dynamic import keeps html-to-image out of the main bundle — it only
 * loads when the user clicks "Tải ảnh", which is rare (once per close-out
 * report).
 *
 * Throws on failure; caller should catch and toast.
 */
/**
 * Width cố định khi chụp: html-to-image capture theo width đang render,
 * nên xuất từ điện thoại (343px) ra ảnh hẹp lè tè khác hẳn desktop.
 * Ép 640px (phiếu max-w-[16cm] ≈ 605px + lề) trong lúc chụp → ảnh
 * deterministic trên mọi thiết bị (spec mobile §5 printable-report).
 */
const EXPORT_WIDTH_PX = 640;

export async function exportElementAsJpeg(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const { toJpeg } = await import("html-to-image");
  const prevWidth = element.style.width;
  element.style.width = `${EXPORT_WIDTH_PX}px`;
  // Chờ 1 frame cho layout reflow ở width mới trước khi chụp.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  try {
    const dataUrl = await toJpeg(element, {
      quality: 0.95,
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
    });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    element.style.width = prevWidth;
  }
}
