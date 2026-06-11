import type { MetadataRoute } from "next";

/**
 * PWA manifest — Next serve tại /manifest.webmanifest và tự gắn <link>
 * vào mọi page. Màu lấy từ design tokens (globals.css):
 * --color-bg-app-from #FAF7F2 (nền cà phê kem).
 * Icon đã có sẵn trong public/ (192 / 512 / maskable).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chill Coffee ERP",
    short_name: "Chill Coffee",
    description: "Hệ thống quản lý vận hành Chill Coffee Garden",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF7F2",
    theme_color: "#FAF7F2",
    lang: "vi",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
