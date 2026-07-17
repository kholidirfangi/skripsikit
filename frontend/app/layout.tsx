import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SkripsiKit — Format Nomor Halaman Skripsi Otomatis",
  description:
    "Rapikan format nomor halaman skripsi kamu otomatis, sesuai kaidah penulisan karya ilmiah.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={plusJakartaSans.className}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
