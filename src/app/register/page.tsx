"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2, BookOpen, UserPlus } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  function validate(): string | null {
    if (email && !EMAIL_RE.test(email.trim())) {
      return "邮箱格式不正确";
    }
    if (password.length < 8) {
      return "密码长度至少为 8 位";
    }
    if (password !== confirmPassword) {
      return "两次输入的密码不一致";
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `注册失败 (HTTP ${res.status})`);
        setLoading(false);
        return;
      }

      // Auto-login after successful registration
      const signRes = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (!signRes || signRes.error) {
        // Registration succeeded but auto-login failed — send to /login
        router.push("/login");
        return;
      }
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError("注册失败，请稍后重试");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shadow-sm">
              <BookOpen className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-base">MedReader Agent</span>
          </div>
          <CardTitle className="text-lg">注册新账号</CardTitle>
          <CardDescription>
            创建账号以保存阅读进度、对话历史与反馈
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">昵称（可选）</Label>
              <Input
                id="name"
                type="text"
                autoComplete="nickname"
                placeholder="如何称呼您？"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="至少 8 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">确认密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            {error && (
              <div
                role="alert"
                className="text-xs rounded-md border border-destructive/30 bg-destructive/10 text-destructive px-3 py-2"
              >
                {error}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3 mt-2">
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading || !email || !password || !confirmPassword
              }
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              注册
            </Button>
            <div className="text-xs text-muted-foreground text-center w-full">
              已有账号？{" "}
              <Link
                href="/login"
                className="text-primary font-medium hover:underline"
              >
                登录
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
