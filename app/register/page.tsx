"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const steps = [
  {
    title: "ใช้ alpha key เพื่อเข้าใช้งานรอบทดสอบ",
    body: "กรอก whitelist key ที่ได้รับเพื่อเปิดสิทธิ์สมัครสมาชิกในรอบ alpha test",
  },
  {
    title: "สร้างบัญชีครั้งเดียว",
    body: "ตั้งอีเมล ชื่อผู้ใช้ และรหัสผ่าน แล้วเริ่มต้นพื้นที่ทำงานส่วนตัวของคุณ",
  },
  {
    title: "เริ่มใช้ AI บันทึกรายการได้ทันที",
    body: "หลังสมัครเสร็จ คุณสามารถคุยกับ AI และติดตามการเงินได้จากหน้าเดียว",
  },
];

const benefits = [
  "อินเทอร์เฟซภาษาไทยที่อ่านง่ายและจัดวางเพื่อใช้งานจริง",
  "เหมาะกับการบันทึกรายจ่ายรายวันและสรุปภาพรวมส่วนตัว",
  "พร้อมใช้งานทั้งบนเดสก์ท็อปและมือถือแบบ web app",
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
      setError("กรุณากรอก alpha whitelist key");
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
    <div className="auth-shell flex min-h-screen items-center px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[1.02fr_0.98fr]">
        <section className="auth-hero order-2 rounded-[34px] p-6 sm:p-8 lg:order-1 lg:p-10">
          <div className="relative space-y-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex w-fit items-center gap-3 rounded-full bg-white/10 px-3 py-2 text-sm text-white/88 ring-1 ring-white/10">
                <div className="auth-brand-mark flex h-12 w-12 items-center justify-center rounded-2xl text-base font-semibold text-white">
                  IA
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-white">IAET AI</p>
                  <p className="text-xs text-slate-300">ระบบจัดการการเงินเวอร์ชันทดลอง</p>
                </div>
              </div>

              <span className="auth-kicker">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-300" />
                Alpha access only
              </span>
            </div>

            <div className="max-w-2xl space-y-4">
              <p className="text-sm font-medium tracking-[0.18em] text-sky-100/88 uppercase">
                Invitation-based onboarding
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-[3.65rem] lg:leading-[1.04]">
                สมัครครั้งเดียว
                <br />
                แล้วเริ่มใช้ AI การเงิน
                <br />
                แบบภาษาไทยได้ทันที
              </h1>
              <p className="max-w-xl text-sm leading-7 text-slate-200 sm:text-base">
                โครงหน้าถูกออกแบบให้เหมือนแอปที่ใช้งานจริงมากกว่าฟอร์มทดลอง ใช้อ่านง่าย กรอกง่าย และพร้อมสำหรับการทดสอบบนมือถือ
              </p>
            </div>

            <div className="grid gap-3">
              {steps.map((item, index) => (
                <div key={item.title} className="auth-feature-card">
                  <div className="flex items-start gap-4">
                    <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white">
                      {index + 1}
                    </div>
                    <div>
                      <p className="text-base font-semibold text-white">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{item.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {benefits.map((item) => (
                <div key={item} className="auth-metric">
                  <p className="text-sm leading-6 text-slate-200">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="auth-panel order-1 rounded-[30px] p-5 sm:p-7 lg:order-2 lg:p-8">
          <div className="mx-auto max-w-md space-y-6">
            <div className="space-y-3">
              <div className="inline-flex rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-white uppercase">
                สมัครสมาชิก
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2.1rem]">
                  เปิดบัญชีสำหรับรอบ alpha
                </h2>
                <p className="text-sm leading-7 text-slate-600">
                  กรอกข้อมูลพื้นฐานพร้อม alpha whitelist key เพื่อเริ่มต้นใช้งาน IAET AI ในรอบทดลองแรก
                </p>
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
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">Alpha whitelist key</span>
                  <span className="text-xs font-medium text-slate-400">เช่น ALPHA-CNCLW-IMHFQ</span>
                </div>
                <input
                  type="text"
                  value={whitelistRef}
                  onChange={(event) => setWhitelistRef(event.target.value)}
                  placeholder="ALPHA-XXXXX-XXXXX"
                  required
                  autoComplete="off"
                  className="auth-input font-medium uppercase tracking-[0.14em]"
                />
              </label>

              <label className="block space-y-2.5">
                <span className="text-sm font-medium text-slate-700">ชื่อผู้ใช้</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="เช่น Chris"
                  required
                  minLength={2}
                  autoComplete="username"
                  className="auth-input"
                />
              </label>

              <label className="block space-y-2.5">
                <span className="text-sm font-medium text-slate-700">รหัสผ่าน</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="auth-input"
                />
              </label>

              <label className="block space-y-2.5">
                <span className="text-sm font-medium text-slate-700">ยืนยันรหัสผ่าน</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="กรอกรหัสผ่านอีกครั้ง"
                  required
                  autoComplete="new-password"
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
                {loading ? "กำลังสร้างบัญชี..." : "สร้างบัญชีและเริ่มใช้งาน"}
              </button>
            </form>

            <div className="rounded-[24px] border border-slate-200/80 bg-white/72 px-4 py-4 text-sm leading-7 text-slate-600">
              มีบัญชีอยู่แล้ว?
              {" "}
              <Link href="/login" className="font-semibold text-slate-950 hover:text-blue-700">
                กลับไปเข้าสู่ระบบ
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
