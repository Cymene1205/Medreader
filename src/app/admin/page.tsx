"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  LogIn,
  Shield,
  ThumbsDown,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

// ---------- Types ----------
type DailyActive = { date: string; users: number };
type DailyAction = {
  date: string;
  analyze: number;
  chat: number;
  translate: number;
  vision: number;
  upload_pdf: number;
};
type FeedbackSummary = { up: number; down: number };
type RecentUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  chatCount: number;
};
type RecentChat = {
  id: string;
  userEmail: string | null;
  question: string;
  paperTitle: string | null;
  createdAt: string | null;
};
type DownFeedback = {
  id: string;
  userEmail: string | null;
  question: string;
  answer: string;
  answerFull: string;
  reason: string | null;
  createdAt: string | null;
  chatLogId: string | null;
};
type Stats = {
  dailyActive: DailyActive[];
  dailyActions: DailyAction[];
  feedbackSummary: FeedbackSummary;
  recentUsers: RecentUser[];
  recentChats: RecentChat[];
  downFeedbacks: DownFeedback[];
  totalUsers: number;
  totalChats: number;
};

// Chart colors mapped to the dim-N CSS variables so they follow the theme.
const DIM_COLORS = [
  "var(--dim-1)",
  "var(--dim-2)",
  "var(--dim-3)",
  "var(--dim-4)",
  "var(--dim-5)",
];
const ACTION_KEYS: Array<{ key: keyof Omit<DailyAction, "date">; label: string }> = [
  { key: "analyze", label: "分析" },
  { key: "chat", label: "对话" },
  { key: "translate", label: "翻译" },
  { key: "vision", label: "视觉" },
  { key: "upload_pdf", label: "上传PDF" },
];

// ---------- Helpers ----------
function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function datePart(iso: string | null): string {
  if (!iso) return "";
  // ISO strings start with YYYY-MM-DD regardless of T or space separator.
  return iso.slice(0, 10);
}

// ---------- Page ----------
export default function AdminPage() {
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Down-feedback filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setForbidden(false);
      setErrorMsg(null);
      try {
        const res = await fetch("/api/admin/stats", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setErrorMsg(j?.detail || j?.error || `HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as Stats;
        setData(json);
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredDown = useMemo(() => {
    if (!data?.downFeedbacks) return [];
    const email = emailFilter.trim().toLowerCase();
    return data.downFeedbacks.filter((f) => {
      const d = datePart(f.createdAt);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      if (email && !(f.userEmail || "").toLowerCase().includes(email)) return false;
      return true;
    });
  }, [data, fromDate, toDate, emailFilter]);

  // ---------- Error / forbidden states ----------
  if (forbidden) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4 text-destructive" />
                需要管理员权限
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                当前账号无权访问该页面。请使用管理员账号登录后再访问。
              </p>
              <div className="flex gap-2">
                <Link href="/login">
                  <Button size="sm" className="gap-1.5">
                    <LogIn className="h-3.5 w-3.5" />
                    前往登录
                  </Button>
                </Link>
                <Link href="/">
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    返回首页
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (errorMsg && !loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 flex items-center justify-center px-6 py-16">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle className="text-base text-destructive">加载失败</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground break-all">{errorMsg}</p>
              <Link href="/">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  返回首页
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // ---------- Main render ----------
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top stat cards */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="总用户数"
            value={data?.totalUsers}
            loading={loading}
            icon={<Users className="h-4 w-4" />}
            colorClass="text-[var(--dim-1)]"
          />
          <StatCard
            label="总对话数"
            value={data?.totalChats}
            loading={loading}
            icon={<Activity className="h-4 w-4" />}
            colorClass="text-[var(--dim-2)]"
          />
          <StatCard
            label="总点踩数"
            value={data?.feedbackSummary?.down}
            loading={loading}
            icon={<ThumbsDown className="h-4 w-4" />}
            colorClass="text-[var(--dim-6)]"
          />
        </section>

        {/* Charts row */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">近30天每日活跃用户数</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data?.dailyActive ?? []}
                      margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickFormatter={(v: string) => formatDateShort(v)}
                        stroke="var(--border)"
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        stroke="var(--border)"
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "var(--foreground)",
                        }}
                        labelFormatter={(v: string) => `日期: ${v}`}
                        formatter={(v: number) => [v, "活跃用户"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="users"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={{ r: 2, fill: "var(--primary)" }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">近30天每日各操作次数</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data?.dailyActions ?? []}
                      margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickFormatter={(v: string) => formatDateShort(v)}
                        stroke="var(--border)"
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        stroke="var(--border)"
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "var(--foreground)",
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        iconType="circle"
                        iconSize={8}
                      />
                      {ACTION_KEYS.map((a, i) => (
                        <Bar
                          key={a.key}
                          dataKey={a.key}
                          name={a.label}
                          stackId="a"
                          fill={DIM_COLORS[i % DIM_COLORS.length]}
                          radius={i === ACTION_KEYS.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">点赞 / 点踩比例</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "点赞", value: data?.feedbackSummary?.up ?? 0, key: "up" },
                          { name: "点踩", value: data?.feedbackSummary?.down ?? 0, key: "down" },
                        ]}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                        stroke="var(--card)"
                        strokeWidth={2}
                        label={(entry: { name?: string; value?: number }) =>
                          `${entry.name}: ${entry.value ?? 0}`
                        }
                        labelLine={false}
                      >
                        <Cell fill="var(--success)" />
                        <Cell fill="var(--destructive)" />
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "var(--foreground)",
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        iconType="circle"
                        iconSize={8}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Two-column tables */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                最近用户
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              {loading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : (
                <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">邮箱</TableHead>
                        <TableHead className="text-xs">注册时间</TableHead>
                        <TableHead className="text-xs">最近活跃</TableHead>
                        <TableHead className="text-xs text-right">对话数</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.recentUsers ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-xs text-muted-foreground text-center py-6">
                            暂无用户
                          </TableCell>
                        </TableRow>
                      ) : (
                        (data?.recentUsers ?? []).map((u) => (
                          <TableRow key={u.id}>
                            <TableCell className="text-xs font-medium truncate max-w-[160px]">
                              {u.email}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(u.createdAt)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(u.lastActiveAt)}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              <Badge variant="secondary" className="font-mono">
                                {u.chatCount}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-3.5 w-3.5" />
                最近对话
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              {loading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : (
                <div className="max-h-[280px] overflow-y-auto scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">用户</TableHead>
                        <TableHead className="text-xs">问题摘要</TableHead>
                        <TableHead className="text-xs">时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.recentChats ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-xs text-muted-foreground text-center py-6">
                            暂无对话
                          </TableCell>
                        </TableRow>
                      ) : (
                        (data?.recentChats ?? []).map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">
                              {c.userEmail || "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="truncate max-w-[280px]" title={c.question}>
                                {c.question || "—"}
                              </div>
                              {c.paperTitle && (
                                <div className="text-[10px] text-muted-foreground truncate max-w-[280px]">
                                  {c.paperTitle}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(c.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Down feedbacks */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ThumbsDown className="h-3.5 w-3.5 text-[var(--dim-6)]" />
              点踩回答收集
              <Badge variant="destructive" className="ml-1">
                {(data?.feedbackSummary?.down ?? 0)} 条
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-3">
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-3 px-2 pt-1">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-muted-foreground">开始日期</label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 w-[150px] text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-muted-foreground">结束日期</label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 w-[150px] text-xs"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                <label className="text-[10px] uppercase text-muted-foreground">用户邮箱过滤</label>
                <Input
                  type="text"
                  placeholder="输入邮箱关键字…"
                  value={emailFilter}
                  onChange={(e) => setEmailFilter(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              {(fromDate || toDate || emailFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setEmailFilter("");
                  }}
                >
                  清除
                </Button>
              )}
              <div className="ml-auto text-[11px] text-muted-foreground self-center">
                显示 {filteredDown.length} / {data?.downFeedbacks?.length ?? 0} 条
              </div>
            </div>

            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <div className="max-h-[520px] overflow-y-auto scrollbar-thin border-t">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-xs w-[140px]">时间</TableHead>
                      <TableHead className="text-xs w-[180px]">用户邮箱</TableHead>
                      <TableHead className="text-xs w-[260px]">原问题</TableHead>
                      <TableHead className="text-xs">原回答</TableHead>
                      <TableHead className="text-xs w-[200px]">点踩原因</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDown.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-8">
                          暂无符合条件的点踩记录
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDown.map((f) => {
                        const expanded = expandedId === f.id;
                        const hasFull = f.answerFull.length > f.answer.length;
                        return (
                          <TableRow
                            key={f.id}
                            className="cursor-pointer"
                            onClick={() => setExpandedId(expanded ? null : f.id)}
                          >
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap align-top pt-2">
                              {formatDateTime(f.createdAt)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground truncate max-w-[180px] align-top pt-2">
                              {f.userEmail || "—"}
                            </TableCell>
                            <TableCell className="text-xs align-top pt-2">
                              <div className="line-clamp-2 max-w-[260px]">{f.question || "—"}</div>
                            </TableCell>
                            <TableCell className="text-xs align-top pt-2">
                              <div className="flex items-start gap-1">
                                <span className="text-muted-foreground mt-[1px]">
                                  {expanded ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                </span>
                                <div
                                  className={
                                    expanded
                                      ? "whitespace-pre-wrap break-words max-w-[440px]"
                                      : "line-clamp-2 max-w-[440px]"
                                  }
                                >
                                  {expanded ? f.answerFull || "（空）" : f.answer || "（空）"}
                                  {!expanded && hasFull && (
                                    <span className="text-muted-foreground ml-1">…</span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground align-top pt-2">
                              <div className="max-w-[200px] line-clamp-3" title={f.reason || ""}>
                                {f.reason || "—"}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t border-border bg-muted/30">
        <div className="max-w-[1400px] mx-auto px-6 py-3 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>MedReader Agent · 管理员后台</span>
          <Link href="/" className="hover:text-foreground transition-colors">
            ← 返回首页
          </Link>
        </div>
      </footer>
    </div>
  );
}

// ---------- Subcomponents ----------
function Header() {
  return (
    <header className="glass-header h-12 flex-shrink-0 flex items-center px-4 gap-3 border-b border-border/30 sticky top-0 z-20">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shadow-sm">
          <Shield className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm text-background">管理员后台</span>
        <span className="text-[10px] opacity-70 hidden sm:inline">MedReader Admin</span>
      </div>
      <div className="flex-1" />
      <Link href="/">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-background hover:bg-background/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回首页
        </Button>
      </Link>
    </header>
  );
}

function StatCard({
  label,
  value,
  loading,
  icon,
  colorClass,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  icon: React.ReactNode;
  colorClass: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="h-8 w-20 mt-2" />
            ) : (
              <p className="text-3xl font-semibold tabular-nums mt-1">{value ?? 0}</p>
            )}
          </div>
          <div className={`p-2 rounded-md bg-muted/60 ${colorClass}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
