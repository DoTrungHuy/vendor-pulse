import type { Metadata } from "next";
import "./globals.css";

const title = "Agent Pulse｜AI 官方更新速览";
const description = "聚合官方新模型、Agent 工具更新与弃用迁移提醒，每条均可直达原文核验。";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    images: ["/og.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
