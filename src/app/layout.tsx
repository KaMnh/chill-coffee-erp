import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { sans, display } from "./fonts";

export const metadata: Metadata = {
  title: "Chill Coffee ERP",
  description: "Hệ thống quản lý vận hành Chill Coffee Garden",
  appleWebApp: {
    capable: true,
    title: "Chill Coffee",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

// PWA / mobile: theme-color tông cà phê kem (--color-bg-app-from) +
// viewport-fit cover để dùng được env(safe-area-inset-*) trên máy tai thỏ.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF7F2",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body suppressHydrationWarning className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
