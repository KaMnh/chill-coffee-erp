import { Manrope, Bricolage_Grotesque } from "next/font/google";

export const sans = Manrope({
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

export const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
  variable: "--font-display",
  weight: ["600", "700"],
});
