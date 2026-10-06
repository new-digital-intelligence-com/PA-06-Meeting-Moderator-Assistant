import type { Metadata } from "next";
import { Archivo_Black, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// NDI's logo letters (components/NdiLogo.tsx), as NDI's own site sets them.
const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  weight: "400",
  subsets: ["latin"],
});

export const viewport = {
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  title: "Ava — Meeting Moderator",
  description:
    "Joins your Google Meet as a participant: reads the agenda, keeps time, takes the notes, and drafts the follow-up with the actions and files.",
};

// Spelled out rather than Next's generated `LayoutProps<"/">`, which only exists after
// a dev or build run has written .next/types — so `npm run typecheck` works from clean.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${archivoBlack.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
