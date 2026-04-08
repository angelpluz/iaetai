"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type AssistantEmotion = "friendly" | "happy" | "concerned" | "encouraging" | "neutral";
type AssistantPersona = "friendly" | "professional" | "coach" | "playful";
type AssistantAvatar = "female" | "male";

interface Transaction {
  id: string;
  item: string;
  amount: number;
  type: string;
  category: string;
  merchant: string;
  bank: string | null;
  datetime: string;
  reference: string | null;
  createdAt: string;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  emotion?: AssistantEmotion;
  imagePreview?: string;
  transaction?: Transaction | null;
  saved?: boolean;
  loading?: boolean;
}

const AVATAR_STORAGE_KEY = "iaet:chat-avatar:v1";
const PERSONA_STORAGE_KEY = "iaet:chat-persona:v1";
const QUICK_PROMPTS = [
  "ช่วยสรุปรายจ่ายวันนี้ให้หน่อย",
  "เพิ่มค่าอาหาร 120 บาท",
  "ฉันโอนเงินเข้าบัญชี 5000 บาท",
];
const AVATAR_OPTIONS: Record<
  AssistantAvatar,
  {
    label: string;
    hint: string;
    src: string;
  }
> = {
  female: {
    label: "ผู้หญิง",
    hint: "คาแรกเตอร์หลัก",
    src: "/448dadee-8a5f-4367-8c65-69f4bdd3372a.png",
  },
  male: {
    label: "ผู้ชาย",
    hint: "ลุคทางเลือก",
    src: "/ChatGPT%20Image%20Apr%208,%202026,%2002_45_00%20PM.png",
  },
};

const CATEGORY_CODE: Record<string, string> = {
  food: "FD",
  transport: "TR",
  shopping: "SH",
  bill: "BL",
  transfer: "TF",
  other: "OT",
};

const CATEGORY_BADGE: Record<string, string> = {
  food: "bg-orange-100 text-orange-700",
  transport: "bg-sky-100 text-sky-700",
  shopping: "bg-fuchsia-100 text-fuchsia-700",
  bill: "bg-amber-100 text-amber-700",
  transfer: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-600",
};

const EMOTION_LABEL: Record<AssistantEmotion, string> = {
  friendly: "เป็นกันเอง",
  happy: "สดใส",
  concerned: "ระวัง",
  encouraging: "สนับสนุน",
  neutral: "กลางๆ",
};

const EMOTION_STYLE: Record<AssistantEmotion, string> = {
  friendly: "bg-blue-50 text-blue-700 border-blue-200",
  happy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  concerned: "bg-amber-50 text-amber-700 border-amber-200",
  encouraging: "bg-violet-50 text-violet-700 border-violet-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
};

const PERSONA_LABEL: Record<AssistantPersona, string> = {
  friendly: "เป็นกันเอง",
  professional: "มืออาชีพ",
  coach: "โค้ช",
  playful: "สนุก",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(value: number) {
  return `THB ${Number(value || 0).toLocaleString("th-TH")}`;
}

function parseReplyAndEmotion(raw: string, incomingEmotion?: string): { text: string; emotion: AssistantEmotion } {
  const rawText = String(raw ?? "");
  const tagMatch = rawText.match(/^\[\[emotion:(friendly|happy|concerned|encouraging|neutral)\]\]\s*/i);
  const fromTag = tagMatch?.[1]?.toLowerCase() as AssistantEmotion | undefined;
  const cleaned = tagMatch ? rawText.replace(tagMatch[0], "").trim() : rawText.trim();

  const fromApi =
    incomingEmotion === "friendly" ||
    incomingEmotion === "happy" ||
    incomingEmotion === "concerned" ||
    incomingEmotion === "encouraging" ||
    incomingEmotion === "neutral"
      ? incomingEmotion
      : undefined;

  return {
    text: cleaned || rawText || "...",
    emotion: fromApi ?? fromTag ?? "friendly",
  };
}

function readPersonaFromStorage(): AssistantPersona {
  if (typeof window === "undefined") return "friendly";
  const value = window.localStorage.getItem(PERSONA_STORAGE_KEY);

  if (value === "friendly" || value === "professional" || value === "coach" || value === "playful") {
    return value;
  }

  return "friendly";
}

function readAvatarFromStorage(): AssistantAvatar {
  if (typeof window === "undefined") return "female";
  const value = window.localStorage.getItem(AVATAR_STORAGE_KEY);
  return value === "male" ? "male" : "female";
}

function TxCard({ tx }: { tx: Transaction }) {
  return (
    <div className="mt-1 max-w-sm rounded-[24px] border border-emerald-200 bg-emerald-50/95 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Saved</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{tx.merchant || tx.item}</p>
        </div>
        <span className="text-sm font-semibold text-slate-900">{formatAmount(tx.amount)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className={`rounded-full px-2.5 py-1 font-medium ${CATEGORY_BADGE[tx.category] ?? CATEGORY_BADGE.other}`}>
          {CATEGORY_CODE[tx.category] ?? "OT"} {tx.category}
        </span>
        {tx.bank ? <span className="rounded-full bg-white px-2.5 py-1">{tx.bank}</span> : null}
      </div>
    </div>
  );
}

function TransactionsList({
  transactions,
  onItemClick,
}: {
  transactions: Transaction[];
  onItemClick?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
      {transactions.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
          ยังไม่มีรายการบันทึก
        </div>
      ) : null}

      {transactions.map((tx) => (
        <button
          key={tx.id}
          onClick={onItemClick}
          className="rounded-[22px] border border-white/70 bg-white/72 px-3 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)] backdrop-blur-lg hover:-translate-y-0.5 hover:border-slate-200"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${CATEGORY_BADGE[tx.category] ?? CATEGORY_BADGE.other}`}>
              {CATEGORY_CODE[tx.category] ?? "OT"} {tx.category}
            </span>
            <span className={`text-sm font-semibold ${tx.type === "income" ? "text-emerald-600" : "text-rose-500"}`}>
              {tx.type === "income" ? "+" : "-"}
              {formatAmount(tx.amount)}
            </span>
          </div>
          <p className="truncate text-sm font-semibold text-slate-900">{tx.merchant || tx.item}</p>
          <p className="mt-1 text-xs text-slate-500">{formatDate(tx.datetime)}</p>
        </button>
      ))}
    </div>
  );
}

export default function ChatPage() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "สวัสดี ส่งข้อความหรือสลิปมาได้เลย ฉันจะช่วยอ่านรายการและบันทึกให้แบบลื่นๆ",
      emotion: "friendly",
    },
  ]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [sending, setSending] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [persona, setPersona] = useState<AssistantPersona>(() => readPersonaFromStorage());
  const [avatar, setAvatar] = useState<AssistantAvatar>(() => readAvatarFromStorage());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTransactions = useCallback(async () => {
    try {
      const response = await fetch("/api/transactions");
      const data = await response.json();
      setTransactions(Array.isArray(data) ? data : (data.transactions ?? []));
    } catch {
      // keep current list if refresh fails
    }
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PERSONA_STORAGE_KEY, persona);
  }, [persona]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AVATAR_STORAGE_KEY, avatar);
  }, [avatar]);

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setPreview(nextFile ? URL.createObjectURL(nextFile) : "");
  }

  function clearFile() {
    setFile(null);
    setPreview("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    if (!input.trim() && !file) return;

    setSending(true);

    const pendingFile = file;
    const pendingInput = input;
    const pendingPreview = preview;

    const userMsg: ChatMsg = {
      id: String(Date.now()),
      role: "user",
      content: pendingInput || (pendingFile ? "แนบสลิปไว้แล้ว" : ""),
      imagePreview: pendingPreview || undefined,
    };

    const nextHistory = msgs.filter((msg) => !msg.loading).slice(-8).concat(userMsg);

    setMsgs((prev) => [...prev, userMsg, { id: "typing", role: "assistant", content: "", loading: true }]);
    setInput("");
    clearFile();

    try {
      let ocrText: string | undefined;

      if (pendingFile) {
        const formData = new FormData();
        formData.append("file", pendingFile);
        const response = await fetch("/api/ocr", { method: "POST", body: formData });

        if (response.ok) {
          const data = await response.json();
          ocrText = data.text || undefined;
        }
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory.map((msg) => ({ role: msg.role, content: msg.content })),
          ocrText,
          persona,
        }),
      });

      const data = await response.json();
      const parsed = parseReplyAndEmotion(data.reply ?? "...", data.emotion);

      const reply: ChatMsg = {
        id: `${Date.now()}_assistant`,
        role: "assistant",
        content: parsed.text,
        emotion: parsed.emotion,
        transaction: data.transaction ?? null,
        saved: data.saved ?? false,
      };

      setMsgs((prev) => prev.filter((msg) => msg.id !== "typing").concat(reply));
      if (data.saved) loadTransactions();
    } catch {
      setMsgs((prev) =>
        prev
          .filter((msg) => msg.id !== "typing")
          .concat({
            id: `${Date.now()}_error`,
            role: "assistant",
            content: "เกิดข้อผิดพลาดระหว่างส่งข้อความ ลองอีกครั้งได้เลย",
            emotion: "concerned",
          })
      );
    } finally {
      setSending(false);
    }
  }

  const totalTransactions = transactions.length;
  const latestTransaction = transactions[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2 sm:px-4 sm:pb-4 sm:pt-3">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4">
        <section className="px-1">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
                <span className="rounded-full bg-white/72 px-3 py-1 shadow-sm ring-1 ring-white/70">
                  {totalTransactions} transactions
                </span>
                <span className="rounded-full bg-white/72 px-3 py-1 shadow-sm ring-1 ring-white/70">
                  Mode: {PERSONA_LABEL[persona]}
                </span>
                <span className="rounded-full bg-white/72 px-3 py-1 shadow-sm ring-1 ring-white/70">
                  Character: {AVATAR_OPTIONS[avatar].label}
                </span>
                {latestTransaction ? (
                  <span className="rounded-full bg-white/72 px-3 py-1 shadow-sm ring-1 ring-white/70">
                    Latest: {latestTransaction.merchant || latestTransaction.item}
                  </span>
                ) : null}
              </div>

              <div className="space-y-2">
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  บันทึกรายการการเงินให้ลื่นเหมือนคุยกับผู้ช่วยส่วนตัว
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-600">
                  พิมพ์ข้อความหรืออัปโหลดสลิป แล้วให้ AI ช่วยอ่าน ตีหมวด และบันทึกข้อมูลให้โดยไม่ทำหน้าให้ดูหนักหรืออึดอัด
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="rounded-full bg-white/74 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-white/70 hover:bg-white lg:hidden"
              >
                รายการล่าสุด
              </button>

              <label className="flex items-center gap-2 rounded-full bg-white/74 px-3 py-2 text-sm shadow-sm ring-1 ring-white/70">
                <span className="text-slate-500">โหมด AI</span>
                <select
                  value={persona}
                  onChange={(event) => setPersona(event.target.value as AssistantPersona)}
                  className="bg-transparent font-medium text-slate-900 outline-none"
                  title="AI persona"
                >
                  {Object.entries(PERSONA_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-2 rounded-full bg-white/74 px-2 py-2 text-sm shadow-sm ring-1 ring-white/70">
                <span className="pl-1 text-slate-500">Character</span>
                <div className="flex items-center gap-1">
                  {(Object.entries(AVATAR_OPTIONS) as [AssistantAvatar, (typeof AVATAR_OPTIONS)[AssistantAvatar]][]).map(
                    ([key, option]) => {
                      const isActive = avatar === key;

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setAvatar(key)}
                          title={`${option.label} ${option.hint}`}
                          className={[
                            "flex items-center gap-2 rounded-full px-2 py-1 pr-3",
                            isActive ? "bg-slate-950 text-white" : "bg-white/70 text-slate-700 hover:bg-white",
                          ].join(" ")}
                        >
                          <Image
                            src={option.src}
                            alt={option.label}
                            width={24}
                            height={24}
                            className="h-6 w-6 rounded-full object-cover"
                          />
                          <span className="hidden text-xs font-medium sm:inline">{option.label}</span>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <Link
                href="/dashboard"
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-950/10 hover:bg-slate-800"
              >
                Dashboard
              </Link>
            </div>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => setInput(prompt)}
                className="shrink-0 rounded-full border border-white/70 bg-white/68 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-white hover:text-slate-900"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col gap-3 lg:flex">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[24px] border border-white/75 bg-white/62 px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Count</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{totalTransactions}</p>
              </div>
              <div className="rounded-[24px] border border-white/75 bg-white/62 px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Mode</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{PERSONA_LABEL[persona]}</p>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-white/75 bg-white/56 p-3 shadow-[0_16px_34px_rgba(15,23,42,0.07)] backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between px-1">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Transactions</p>
                  <p className="mt-1 text-sm text-slate-500">รายการล่าสุดของคุณ</p>
                </div>
              </div>
              <TransactionsList transactions={transactions} />
            </div>
          </aside>

          {mobileSidebarOpen ? (
            <div className="fixed inset-0 z-50 flex items-end lg:hidden">
              <button
                className="absolute inset-0 bg-slate-950/18 backdrop-blur-[2px]"
                onClick={() => setMobileSidebarOpen(false)}
                aria-label="Close transactions panel"
              />
              <aside className="relative z-10 flex max-h-[72vh] w-full flex-col rounded-t-[28px] border border-white/70 bg-white/90 p-4 shadow-[0_-18px_50px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Transactions</p>
                    <p className="mt-1 text-sm text-slate-600">{totalTransactions} รายการ</p>
                  </div>
                  <button
                    onClick={() => setMobileSidebarOpen(false)}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
                  >
                    ปิด
                  </button>
                </div>
                <TransactionsList transactions={transactions} onItemClick={() => setMobileSidebarOpen(false)} />
              </aside>
            </div>
          ) : null}

          <section className="relative min-h-[70vh] overflow-hidden rounded-[30px] border border-white/78 bg-[linear-gradient(180deg,rgba(255,255,255,0.66),rgba(255,255,255,0.88))] shadow-[0_20px_48px_rgba(15,23,42,0.09)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(94,234,212,0.12),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0))]" />

            <div className="relative flex min-h-full flex-col">
              <div className="flex items-center justify-between border-b border-white/80 px-4 py-4 sm:px-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Conversation</p>
                  <p className="mt-1 text-sm text-slate-600">คุยกับ AI แล้วบันทึกรายการได้ทันที</p>
                </div>
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm ring-1 ring-white/70">
                  live
                </span>
              </div>

              <div className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-44 pt-5 sm:px-5">
                <div className="space-y-4">
                  {msgs.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-3`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="flex shrink-0 flex-col items-center gap-2 sm:mt-1">
                          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-white/90 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.16)] sm:h-16 sm:w-16 md:h-20 md:w-20">
                            <Image
                              src={AVATAR_OPTIONS[avatar].src}
                              alt="AI avatar"
                              width={80}
                              height={80}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="flex flex-col items-center gap-1 sm:hidden">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              IAET AI
                            </span>
                            {msg.emotion ? (
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${EMOTION_STYLE[msg.emotion]}`}
                              >
                                Mood: {EMOTION_LABEL[msg.emotion]}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex max-w-[90%] flex-col gap-2 sm:max-w-[72%]">
                        {msg.imagePreview ? (
                          <Image
                            unoptimized
                            src={msg.imagePreview}
                            alt="Slip preview"
                            width={640}
                            height={480}
                            className="max-h-64 w-auto rounded-[24px] border border-white/80 object-contain shadow-sm"
                          />
                        ) : null}

                        {msg.loading ? (
                          <div className="rounded-[24px] rounded-tl-sm bg-white/88 px-4 py-4 shadow-sm ring-1 ring-white/80">
                            <div className="flex items-center gap-1">
                              {[0, 160, 320].map((delay) => (
                                <span
                                  key={delay}
                                  className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                                  style={{ animationDelay: `${delay}ms` }}
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <>
                            {msg.role === "assistant" && msg.emotion ? (
                              <span className={`hidden w-fit rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${EMOTION_STYLE[msg.emotion]}`}>
                                Mood: {EMOTION_LABEL[msg.emotion]}
                              </span>
                            ) : null}

                            {msg.content ? (
                              <div
                                className={[
                                  "rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm",
                                  msg.role === "user"
                                    ? "rounded-tr-sm bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)]"
                                    : "rounded-tl-sm bg-white/90 text-slate-800 ring-1 ring-white/80",
                                ].join(" ")}
                              >
                                {msg.content}
                              </div>
                            ) : null}

                            {msg.saved && msg.transaction ? <TxCard tx={msg.transaction} /> : null}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div ref={bottomRef} />
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-white via-white/92 to-transparent" />

              <div className="absolute inset-x-3 bottom-3 z-10 space-y-3 sm:inset-x-5 sm:bottom-4">
                {preview ? (
                  <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-[22px] border border-white/80 bg-white/88 px-3 py-3 shadow-[0_14px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                    <Image
                      unoptimized
                      src={preview}
                      alt="Upload preview"
                      width={72}
                      height={72}
                      className="h-14 w-14 rounded-[18px] object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{file?.name}</p>
                      <p className="text-xs text-slate-500">พร้อมส่งให้ AI อ่านข้อมูลจากสลิป</p>
                    </div>
                    <button
                      onClick={clearFile}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200"
                    >
                      ลบ
                    </button>
                  </div>
                ) : null}

                <div className="mx-auto max-w-3xl rounded-[28px] border border-white/82 bg-white/94 p-3 shadow-[0_18px_46px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                  <div className="flex items-end gap-2">
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                      title="Attach slip"
                    >
                      IMG
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

                    <div className="flex min-h-[46px] flex-1 items-center rounded-[20px] bg-slate-50 px-3 ring-1 ring-slate-200 focus-within:ring-blue-300">
                      <input
                        type="text"
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey && !sending) {
                            event.preventDefault();
                            send();
                          }
                        }}
                        placeholder="พิมพ์ข้อความหรือแนบสลิปเพื่อเริ่มต้น"
                        className="w-full bg-transparent py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>

                    <button
                      onClick={send}
                      disabled={sending || (!input.trim() && !file)}
                      className="accent-ring inline-flex h-11 shrink-0 items-center justify-center rounded-[18px] bg-slate-950 px-4 text-sm font-semibold text-white hover:-translate-y-0.5 hover:bg-slate-800 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {sending ? "ส่ง..." : "ส่ง"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
