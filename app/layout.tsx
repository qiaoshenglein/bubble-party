import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QQ堂 · 泡泡派对 | 一起开泡",
  description: "重温经典泡泡对战，三张卡通地图，AI 练习与好友在线对战。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
