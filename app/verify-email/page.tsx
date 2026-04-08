"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type VerifyStatus = "loading" | "success" | "error";

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<VerifyStatus>(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "" : "ไม่พบ token สำหรับยืนยันอีเมล");

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    async function verifyEmail() {
      try {
        const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
        const data = await response.json();

        if (!isMounted) return;

        if (response.ok) {
          setStatus("success");
          setMessage(`ยืนยันอีเมลสำเร็จแล้ว ยินดีต้อนรับ ${data.user?.username ?? "ผู้ใช้ใหม่"}`);
          redirectTimer = setTimeout(() => router.push("/chat"), 2200);
          return;
        }

        setStatus("error");
        setMessage(data.error ?? "ยืนยันอีเมลไม่สำเร็จ กรุณาลองอีกครั้ง");
      } catch {
        if (!isMounted) return;
        setStatus("error");
        setMessage("เกิดปัญหาในการเชื่อมต่อเซิร์ฟเวอร์");
      }
    }

    verifyEmail();

    return () => {
      isMounted = false;
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [router, token]);

  const tone =
    status === "success"
      ? {
          badge: "bg-emerald-100 text-emerald-700",
          title: "text-emerald-700",
          icon: "OK",
          heading: "ยืนยันอีเมลสำเร็จ",
          hint: "กำลังพาไปหน้าแชตอัตโนมัติ",
        }
      : status === "error"
        ? {
            badge: "bg-rose-100 text-rose-700",
            title: "text-rose-700",
            icon: "NO",
            heading: "ยืนยันอีเมลไม่สำเร็จ",
            hint: "คุณสามารถกลับไปเข้าสู่ระบบหรือขออีเมลใหม่ได้ภายหลัง",
          }
        : {
            badge: "bg-blue-100 text-blue-700",
            title: "text-blue-700",
            icon: "...",
            heading: "กำลังตรวจสอบอีเมล",
            hint: "โปรดรอสักครู่ เรากำลังตรวจสอบลิงก์ยืนยันของคุณ",
          };

  return (
    <div className="flex min-h-screen items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="glass-panel mx-auto w-full max-w-2xl rounded-[32px] p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4 rounded-[28px] bg-slate-950 px-6 py-7 text-white">
            <div className="inline-flex w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">
              Email verification
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight">บัญชีของคุณใกล้พร้อมใช้งานแล้ว</h1>
              <p className="text-sm leading-7 text-slate-300">
                หลังยืนยันสำเร็จ คุณจะถูกพาไปที่ห้องแชตเพื่อเริ่มบันทึกรายรับรายจ่ายและดูแดชบอร์ดการเงินทันที
              </p>
            </div>
          </div>

          <div className="app-card rounded-[28px] px-5 py-6 text-center sm:px-6 sm:py-7">
            <div className={`mx-auto mb-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone.badge}`}>
              {tone.icon}
            </div>

            {status === "loading" ? (
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            ) : null}

            <h2 className={`text-2xl font-semibold tracking-tight ${tone.title}`}>{tone.heading}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">{message || tone.hint}</p>
            <p className="mt-2 text-xs text-slate-400">{tone.hint}</p>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/login"
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
              >
                ไปหน้าเข้าสู่ระบบ
              </Link>
              <Link
                href="/chat"
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-950/10 hover:bg-slate-800"
              >
                ไปหน้าแชต
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
