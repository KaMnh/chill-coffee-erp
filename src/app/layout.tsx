import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { sans, display } from "./fonts";

export const metadata: Metadata = {
  title: "Chill Coffee ERP",
  description: "Hệ thống quản lý vận hành Chill Coffee Garden",
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
