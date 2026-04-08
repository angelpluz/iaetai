"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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
    <div className="auth-shell flex min-h-screen items-center px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="relative z-10 mx-auto w-full max-w-lg">
        <section className="auth-panel rounded-[30px] p-5 sm:p-7 lg:p-8">
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="inline-flex w-fit items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <div className="auth-brand-mark flex h-12 w-12 items-center justify-center rounded-2xl text-base font-semibold text-white">
                  IA
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-950">IAET AI</p>
                  <p className="text-xs text-slate-500">Expense intelligence cockpit</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="inline-flex rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white uppercase">
                  เข้าสู่ระบบ
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2.2rem]">
                  กลับเข้าสู่พื้นที่ทำงาน
                </h1>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block space-y-2.5">
                <span className="text-sm font-medium text-slate-700">อีเมล</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="auth-input"
                />
              </label>

              <label className="block space-y-2.5">
                <span className="text-sm font-medium text-slate-700">รหัสผ่าน</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="กรอกรหัสผ่าน"
                  required
                  autoComplete="current-password"
                  className="auth-input"
                />
              </label>

              {error ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="auth-submit flex w-full items-center justify-center rounded-[20px] bg-slate-950 px-4 py-3.5 text-sm font-semibold text-white hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
              </button>
            </form>

            <div className="rounded-[24px] border border-slate-200/80 bg-white/72 px-4 py-4 text-sm leading-7 text-slate-600">
              ยังไม่มีบัญชี?{" "}
              <Link href="/register" className="font-semibold text-slate-950 hover:text-blue-700">
                สมัครสมาชิกด้วย alpha key
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
