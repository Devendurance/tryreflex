import type { Metadata, Viewport } from "next";
import { Georama, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const georama = Georama({
  variable: "--font-georama",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [
    { path: "./fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Reflex | Decision intelligence for active traders",
  description:
    "Reflex reviews how you decided, not just what you earned. Decision review, Decision DNA, Pre-Trade Recall and a Playbook you control, for crypto and tokenized US equities.",
};

export const viewport: Viewport = {
  themeColor: "#F6EADC",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${newsreader.variable} ${georama.variable} ${satoshi.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
