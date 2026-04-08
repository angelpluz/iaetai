"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const bullets = [
  "สร้างบัญชีแล้วเริ่มคุยกับ AI เพื่อบันทึกรายการได้ทันที",
  "รองรับการตั้งงบประมาณและดูภาพรวมรายจ่ายตามหมวด",
  "อินเทอร์เฟซใหม่ออกแบบให้ใช้ง่ายทั้งมือถือและเดสก์ท็อป",
];

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [whitelistRef, setWhitelistRef] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    if (password.length < 6) {
      setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }

    if (!whitelistRef.trim()) {
      setError("Alpha whitelist key is required");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          username,
          password,
          whitelistRef: whitelistRef.trim().toUpperCase(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "สมัครสมาชิกไม่สำเร็จ");
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
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="glass-panel relative overflow-hidden rounded-[32px] p-6 sm:p-8 lg:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(37,99,235,0.2),transparent_34%)]" />
          <div className="relative space-y-8">
            <div className="inline-flex items-center gap-3 rounded-full bg-white/80 px-3 py-2 text-sm text-slate-700">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#2563eb_58%,#5eead4)] font-semibold text-white">
                IA
              </div>
              <div>
                <p className="font-semibold text-slate-900">IAET AI</p>
                <p className="text-xs text-slate-500">Start your finance workspace</p>
              </div>
            </div>

            <div className="space-y-4">
              <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                New account
              </span>
              <div className="space-y-3">
                <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  เปิดบัญชีใหม่แล้วเริ่มจัดการการเงินแบบมีโครงสร้าง
                </h1>
                <p className="max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                  สร้างบัญชีครั้งเดียว แล้วใช้แชต AI, วิเคราะห์สลิป, และติดตามงบประมาณของคุณได้จากที่เดียว
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {bullets.map((item, index) => (
                <div key={item} className="app-card rounded-2xl px-4 py-4 text-sm text-slate-700">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                    Step {index + 1}
                  </p>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[32px] p-5 sm:p-7">
          <div className="mx-auto max-w-md space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Create account</p>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">สมัครสมาชิก</h2>
              <p className="text-sm leading-6 text-slate-600">
                กรอกข้อมูลพื้นฐานเพื่อเริ่มต้นใช้งาน IAET AI
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
                <span className="text-sm font-medium text-slate-700">Alpha whitelist key</span>
                <input
                  type="text"
                  value={whitelistRef}
                  onChange={(event) => setWhitelistRef(event.target.value)}
                  placeholder="ALPHA-XXXXX-XXXXX"
                  required
                  autoComplete="off"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm font-medium uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">ชื่อผู้ใช้</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="เช่น Chris"
                  required
                  minLength={2}
                  autoComplete="username"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">รหัสผ่าน</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">ยืนยันรหัสผ่าน</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="กรอกรหัสผ่านอีกครั้ง"
                  required
                  autoComplete="new-password"
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
                {loading ? "กำลังสร้างบัญชี..." : "สร้างบัญชี"}
              </button>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-4 text-sm text-slate-600">
              มีบัญชีอยู่แล้ว?{" "}
              <Link href="/login" className="font-semibold text-[color:var(--accent-strong)] hover:text-blue-600">
                เข้าสู่ระบบ
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
