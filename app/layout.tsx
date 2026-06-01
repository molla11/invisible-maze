import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Invisible Maze",
  description: "A two-player hidden maze race."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
