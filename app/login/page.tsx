"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const highlights = [
  "อัปโหลดสลิปแล้วให้ AI ช่วยอ่านรายการให้อัตโนมัติ",
  "ดูสรุปรายรับรายจ่ายและยอดคงเหลือในหน้าเดียว",
  "ตั้งงบประมาณรายหมวดและติดตามการใช้เงินจริงได้ทันที",
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }

      router.push("/chat");
      router.refresh();
    } catch {
      setError("ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="glass-panel relative overflow-hidden rounded-[32px] p-6 sm:p-8 lg:p-10">
          <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.24),transparent_58%),radial-gradient(circle_at_top_right,rgba(20,184,166,0.18),transparent_48%)]" />
          <div className="relative space-y-8">
            <div className="inline-flex items-center gap-3 rounded-full bg-white/80 px-3 py-2 text-sm text-slate-700">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#2563eb_58%,#5eead4)] font-semibold text-white">
                IA
              </div>
              <div>
                <p className="font-semibold text-slate-900">IAET AI</p>
                <p className="text-xs text-slate-500">Expense intelligence cockpit</p>
              </div>
            </div>

            <div className="space-y-4">
              <span className="inline-flex rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-strong)]">
                Personal finance assistant
              </span>
              <div className="space-y-3">
                <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  จัดการรายรับรายจ่ายให้เป็นระบบมากขึ้นในไม่กี่คลิก
                </h1>
                <p className="max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                  เข้าสู่ระบบเพื่อคุยกับ AI, บันทึกสลิป, และดูภาพรวมการเงินที่อ่านง่ายทั้งบนเดสก์ท็อปและมือถือ
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {highlights.map((item) => (
                <div
                  key={item}
                  className="app-card flex items-start gap-3 rounded-2xl px-4 py-4 text-sm text-slate-700"
                >
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                    OK
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[32px] p-5 sm:p-7">
          <div className="mx-auto max-w-md space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Welcome back</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">เข้าสู่ระบบ</h2>
              <p className="text-sm leading-6 text-slate-600">
                ใช้อีเมลและรหัสผ่านเดิมเพื่อกลับเข้าสู่พื้นที่ทำงานของคุณ
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">อีเมล</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">รหัสผ่าน</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="กรอกรหัสผ่าน"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="accent-ring flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
              </button>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-4 text-sm text-slate-600">
              ยังไม่มีบัญชี?{" "}
              <Link href="/register" className="font-semibold text-[color:var(--accent-strong)] hover:text-blue-600">
                สมัครสมาชิก
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
