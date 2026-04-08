"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/chat", label: "Chat" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function NavBar({ username }: { username: string }) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="mx-auto max-w-6xl rounded-full border border-white/70 bg-white/58 px-3 py-2 shadow-[0_14px_34px_rgba(19,46,93,0.12)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link href="/chat" className="flex min-w-0 items-center gap-3 pr-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0f172a,#2563eb_58%,#5eead4)] text-xs font-semibold text-white shadow-lg shadow-blue-500/20">
              IA
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-slate-950">IAET AI</p>
              <p className="hidden truncate text-[11px] text-slate-500 sm:block">{username}</p>
            </div>
          </Link>

          <nav className="order-3 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5 sm:order-2 sm:ml-2">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium",
                    isActive
                      ? "bg-slate-950 text-white shadow-lg shadow-slate-950/10"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-950",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
            <span className="hidden rounded-full bg-white/65 px-3 py-1.5 text-xs text-slate-500 shadow-sm sm:inline-block">
              {username}
            </span>
            <button
              onClick={handleLogout}
              className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-white hover:text-slate-950"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
