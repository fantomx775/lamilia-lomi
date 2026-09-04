import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getCanonicalAppUrl } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getCanonicalAppUrl(),
  title: {
    default: "LamiliaLomi",
    template: "%s | LamiliaLomi",
  },
  description:
    "A calm premium platform for LamiliaLomi books, Amazon KDP readers, and protected bonus materials.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
        {children}
      </body>
    </html>
  );
}
