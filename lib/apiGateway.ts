const BASE_URL = process.env.API_GATEWAY_URL || "http://localhost:4272";
const API_KEY = process.env.API_GATEWAY_KEY || "";

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  user?: { uid: string; email: string; username: string };
}

export interface NewsItem {
  id: number;
  title: string;
  content: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PeopleReport {
  id: number;
  name: string;
  phone: string;
  message: string;
  location: string;
  imageUrl: string | null;
  status: "new" | "in-progress" | "done";
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: number;
  note: string;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string; useApiKey?: boolean } = {}
): Promise<T> {
  const { token, useApiKey, ...init } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (useApiKey) {
    headers["X-API-Key"] = API_KEY;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function gatewayLogin(
  username: string,
  password: string
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function gatewayRegister(
  email: string,
  username: string,
  password: string,
  whitelistRef: string
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/v1/users/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password, whitelistRef }),
  });
}

export async function gatewayUserLogin(
  email: string,
  password: string
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/v1/users/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// ── Notes (JWT protected) ─────────────────────────────────────────────────────
export async function gatewayGetNotes(token: string): Promise<Note[]> {
  return apiFetch<Note[]>("/api/v1/notes", { token });
}

export async function gatewayCreateNote(
  note: string,
  token: string
): Promise<{ id: number }> {
  return apiFetch<{ id: number }>("/api/v1/notes", {
    method: "POST",
    body: JSON.stringify({ note }),
    token,
  });
}

// ── News (public read, API key write) ─────────────────────────────────────────
export async function gatewayGetNews(): Promise<NewsItem[]> {
  return apiFetch<NewsItem[]>("/api/v1/news");
}

export async function gatewayGetNewsById(id: number): Promise<NewsItem> {
  return apiFetch<NewsItem>(`/api/v1/news/${id}`);
}

// ── Reports (public create, API key list) ─────────────────────────────────────
export async function gatewayCreateReport(data: {
  name: string;
  phone: string;
  message: string;
  location: string;
  imageUrl?: string;
}): Promise<PeopleReport> {
  return apiFetch<PeopleReport>("/api/v1/reports", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function gatewayGetReports(token: string): Promise<PeopleReport[]> {
  return apiFetch<PeopleReport[]>("/api/v1/reports", { token });
}
