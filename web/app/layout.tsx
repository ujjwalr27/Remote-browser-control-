import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Remote Browser Control",
  description: "Control a headless Chromium running in Docker, from your browser.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
