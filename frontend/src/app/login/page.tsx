"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api/client";
import { setToken } from "@/lib/auth";
import type { components } from "@/lib/api/schema";

type TokenResponse = components["schemas"]["TokenResponse"];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/signup";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, full_name: fullName || null };
      const res = await apiFetch<TokenResponse>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setToken(res.access_token);
      router.push("/");
    } catch {
      setError(
        mode === "login"
          ? "Email hoặc mật khẩu không đúng."
          : "Đăng ký thất bại (email có thể đã tồn tại).",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
            V
          </div>
          <span className="text-lg font-bold">VHB Super App</span>
        </div>

        <h1 className="mb-1 text-xl font-bold">
          {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {mode === "login"
            ? "Nhập email và mật khẩu để tiếp tục."
            : "Đăng ký tài khoản mới."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Họ tên (tuỳ chọn)"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Mật khẩu (≥ 8 ký tự)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading
              ? "Đang xử lý…"
              : mode === "login"
                ? "Đăng nhập"
                : "Đăng ký"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
          className="mt-4 w-full text-center text-sm text-primary hover:underline"
        >
          {mode === "login"
            ? "Chưa có tài khoản? Đăng ký"
            : "Đã có tài khoản? Đăng nhập"}
        </button>
      </div>
    </div>
  );
}
