import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sriracha } from "next/font/google";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import "./globals.css";
import NavBar from "./NavBar";
import PWAInstallPrompt from "./pwa-install-prompt";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sriracha = Sriracha({
  subsets: ["thai", "latin"],
  weight: ["400"],
  variable: "--font-sriracha",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "IAET AI",
    template: "%s | IAET AI",
  },
  applicationName: "IAET AI",
  description: "AI Expense Tracker",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "IAET AI",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10233e",
};

async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    const username = (payload.username as string | undefined) ?? (payload.sub as string);
    return { username };
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser();

  return (
    <html
      lang="th"
      data-scroll-behavior="smooth"
      className={`${sriracha.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-[color:var(--foreground)]">
        <div className="relative flex min-h-screen flex-col">
          {user && <NavBar username={user.username} />}
          <main className="relative z-10 flex flex-1 flex-col">{children}</main>
          {process.env.NODE_ENV === "production" ? <PWAInstallPrompt /> : null}
        </div>
      </body>
    </html>
  );
}
