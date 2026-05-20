/**
 * Export a DOM node as a JPEG download via html-to-image.
 *
 * Dynamic import keeps html-to-image out of the main bundle — it only
 * loads when the user clicks "Tải ảnh", which is rare (once per close-out
 * report).
 *
 * Throws on failure; caller should catch and toast.
 */
export async function exportElementAsJpeg(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const { toJpeg } = await import("html-to-image");
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
}
