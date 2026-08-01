#!/usr/bin/env python3
"""
MedReader Agent — End-to-end smoke test (Python edition)
=========================================================
单进程管理：自己起 dev server，等就绪，跑所有测试，最后清理。

用法: python3 /home/z/my-project/scripts/e2e_smoke_test.py
"""
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.parse
import http.cookiejar
import urllib.request
from pathlib import Path

BASE = "http://localhost:3001"
PROJECT = "/home/z/my-project"
DEV_LOG = Path(PROJECT) / "dev.log"

PASS = 0
FAIL = 0
FAILURES = []


def log(msg):
    print(msg, flush=True)


def check(name, expected, actual, extra=""):
    global PASS, FAIL
    if str(actual) == str(expected):
        log(f"  ✅ {name} (HTTP {actual}) {extra}")
        PASS += 1
    else:
        log(f"  ❌ {name} — 期望 {expected}, 实际 {actual} {extra}")
        FAIL += 1
        FAILURES.append(f"{name} (期望 {expected}, 实际 {actual})")


def http_request(method, url, *, body=None, headers=None, cookies=None,
                 timeout=30, allow_redirects=True):
    """发起 HTTP 请求，返回 (status_code, body_text, response_headers)。"""
    if cookies is None:
        cookies = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    if not allow_redirects:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, hdrs, newurl):
                return None
        opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(cookies))
    req_headers = {"User-Agent": "MedReader-E2E-Test/1.0"}
    if headers:
        req_headers.update(headers)
    data = None
    if body is not None:
        if isinstance(body, dict):
            if req_headers.get("Content-Type", "").startswith("application/json"):
                data = json.dumps(body).encode()
            else:
                data = urllib.parse.urlencode(body).encode()
        elif isinstance(body, bytes):
            data = body
        else:
            data = str(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    try:
        resp = opener.open(req, timeout=timeout)
        return resp.status, resp.read().decode("utf-8", errors="replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace"), dict(e.headers)
    except urllib.error.URLError as e:
        return 0, f"URLError: {e}", {}
    except Exception as e:
        return 0, f"Exception: {e}", {}


def wait_dev_server(timeout=60):
    """轮询 / 直到 dev server 返回 200。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, _, _ = http_request("GET", f"{BASE}/", timeout=5)
        if code == 200:
            return True
        time.sleep(2)
    return False


def main():
    global PASS, FAIL

    log("=" * 60)
    log(f"MedReader E2E Smoke Test — {time.strftime('%H:%M:%S')}")
    log("=" * 60)
    log("")

    # ── 启动 dev server ─────────────────────────────────────────────────
    log("【0/12】启动 dev server (port 3001)...")
    # 先杀掉旧的
    subprocess.run("pkill -9 -f 'next' 2>/dev/null; sleep 2", shell=True)
    # 清理锁
    (Path(PROJECT) / ".next" / "dev" / "lock").unlink(missing_ok=True)
    # 用 preexec_fn=os.setsid 让进程脱离父进程组
    env = os.environ.copy()
    env["PORT"] = "3001"
    DEV_LOG.unlink(missing_ok=True)
    with open(DEV_LOG, "w") as logf:
        proc = subprocess.Popen(
            ["npx", "next", "dev", "-p", "3001"],
            cwd=PROJECT,
            stdout=logf,
            stderr=subprocess.STDOUT,
            env=env,
            preexec_fn=os.setsid,
        )

    try:
        if not wait_dev_server(timeout=60):
            log(f"  ❌ Dev server 60 秒内未就绪")
            log(f"  dev.log 末尾:")
            log(DEV_LOG.read_text()[-2000:])
            return 1
        log(f"  ✅ Dev server 已就绪 (pid={proc.pid})")
        log("")

        # ── 1. 公开页面 ─────────────────────────────────────────────────
        log("【1/12】公开页面加载测试")
        check("首页 /", 200, http_request("GET", f"{BASE}/")[0])
        check("登录页 /login", 200, http_request("GET", f"{BASE}/login")[0])
        check("注册页 /register", 200, http_request("GET", f"{BASE}/register")[0])

        # 验证登录页无 biorhythm-avatar
        _, login_html, _ = http_request("GET", f"{BASE}/login")
        if "biorhythm-avatar" in login_html:
            log("  ❌ 登录页仍含 biorhythm-avatar")
            FAIL += 1; FAILURES.append("login page still has biorhythm-avatar")
        else:
            log("  ✅ 登录页无 biorhythm-avatar")
            PASS += 1
        log("")

        # ── 2. 注册 ─────────────────────────────────────────────────────
        test_email = f"e2e-test-{int(time.time())}@test.local"
        test_pwd = "Test1234Pass"
        log(f"【2/12】用户注册测试 ({test_email})")
        code, body, _ = http_request("POST", f"{BASE}/api/auth/register",
            body={"email": test_email, "password": test_pwd, "name": "E2E Tester"},
            headers={"Content-Type": "application/json"})
        # 200 或 201 都算注册成功 (201 = Created)
        if code in (200, 201):
            check("POST /api/auth/register", code, code)
        else:
            check("POST /api/auth/register", "200/201", code)
        log(f"    响应: {body[:200]}")
        log("")

        # ── 3. 登录 ─────────────────────────────────────────────────────
        log("【3/12】登录测试")
        cookies = http.cookiejar.CookieJar()
        # 先拿 csrf token
        _, csrf_body, _ = http_request("GET", f"{BASE}/api/auth/csrf", cookies=cookies)
        csrf_match = re.search(r'"csrfToken":"([^"]+)"', csrf_body)
        if not csrf_match:
            log("  ❌ 拿不到 csrfToken")
            FAIL += 1; FAILURES.append("csrf token fetch failed")
        else:
            csrf = csrf_match.group(1)
            # 提交登录
            code, body, _ = http_request("POST", f"{BASE}/api/auth/callback/credentials",
                body={
                    "email": test_email,
                    "password": test_pwd,
                    "csrfToken": csrf,
                    "callbackUrl": f"{BASE}/app",
                    "json": "true",
                },
                cookies=cookies,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                allow_redirects=False,
            )
            # callback 通常返回 200 (json=true 模式) 或 302
            if code in (200, 302):
                log(f"  ✅ 登录流程完成 (HTTP {code})")
                PASS += 1
            else:
                log(f"  ❌ 登录失败 (HTTP {code}) — {body[:200]}")
                FAIL += 1; FAILURES.append(f"login failed ({code})")

            # 验证 session
            code, body, _ = http_request("GET", f"{BASE}/api/auth/session", cookies=cookies)
            if '"user"' in body:
                log("  ✅ Session 有效")
                PASS += 1
            else:
                log(f"  ❌ Session 无效 — {body[:200]}")
                FAIL += 1; FAILURES.append("session invalid")
        log("")

        # ── 4. /api/quota ───────────────────────────────────────────────
        log("【4/12】额度查询 /api/quota")
        code, body, _ = http_request("GET", f"{BASE}/api/quota", cookies=cookies)
        check("GET /api/quota", 200, code)
        try:
            q = json.loads(body)
            actions = q.get("actions", {})
            if len(actions) >= 4:
                log(f"  ✅ 返回 {len(actions)} 个 action 额度")
                PASS += 1
            else:
                log(f"  ❌ 只返回 {len(actions)} 个 action (期望 4)")
                FAIL += 1; FAILURES.append(f"quota actions incomplete ({len(actions)}/4)")
            log(f"    响应: {body[:300]}")
        except Exception as e:
            log(f"  ❌ JSON 解析失败: {e}")
            FAIL += 1; FAILURES.append("quota response not JSON")
        log("")

        # ── 5. 管理员后台 ───────────────────────────────────────────────
        log("【5/12】管理员后台 /api/admin/stats")
        admin_cookies = http.cookiejar.CookieJar()
        _, csrf2_body, _ = http_request("GET", f"{BASE}/api/auth/csrf", cookies=admin_cookies)
        csrf2 = re.search(r'"csrfToken":"([^"]+)"', csrf2_body)
        if csrf2:
            http_request("POST", f"{BASE}/api/auth/callback/credentials",
                body={
                    "email": "admin@local",
                    "password": "admin123456",
                    "csrfToken": csrf2.group(1),
                    "callbackUrl": f"{BASE}/admin",
                    "json": "true",
                },
                cookies=admin_cookies,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                allow_redirects=False,
            )
        code, body, _ = http_request("GET", f"{BASE}/api/admin/stats", cookies=admin_cookies)
        check("GET /api/admin/stats (admin)", 200, code)

        # 验证 quota 识别 admin
        code, body, _ = http_request("GET", f"{BASE}/api/quota", cookies=admin_cookies)
        if '"isAdmin":true' in body or '"isAdmin": true' in body:
            log("  ✅ /api/quota 正确识别 admin")
            PASS += 1
        else:
            log(f"  ❌ /api/quota 未识别 admin — {body[:200]}")
            FAIL += 1; FAILURES.append("quota isAdmin not true for admin")
        log("")

        # ── 6. 未登录上传拦截 ──────────────────────────────────────────
        log("【6/12】未登录上传拦截")
        # 用空 form data，应该返回 401
        boundary = "----E2ETestBoundary"
        body_bytes = f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 test\r\n--{boundary}--\r\n".encode()
        code, body, _ = http_request("POST", f"{BASE}/api/upload",
            body=body_bytes,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        check("POST /api/upload (无 session)", 401, code)
        log("")

        # ── 7. /api/chat 匿名 ──────────────────────────────────────────
        log("【7/12】匿名 chat 调用")
        code, body, _ = http_request("POST", f"{BASE}/api/chat",
            body={
                "question": "什么是DNA?",
                "messages": [],
                "markdown": "DNA is deoxyribonucleic acid, the molecule that carries genetic information."
            },
            headers={"Content-Type": "application/json"},
            timeout=60)
        check("POST /api/chat (匿名)", 200, code)
        chat_log_id = None
        if '"delta"' in body:
            log("  ✅ 返回 SSE delta 数据")
            PASS += 1
        elif '"error"' in body:
            log(f"  ⚠️  返回 error (LLM 调用问题): {body[:200]}")
        elif "__meta__" in body:
            log("  ✅ ChatLog 已保存")
            PASS += 1
        # 从 SSE 流里解析 chatLogId (用于后面 feedback 测试)
        m = re.search(r'"__meta__":\s*\{\s*"chatLogId":\s*"([^"]+)"', body)
        if m:
            chat_log_id = m.group(1)
            log(f"  📝 拿到 chatLogId: {chat_log_id}")
        log("")

        # ── 8. /api/translate ──────────────────────────────────────────
        log("【8/12】翻译 /api/translate")
        code, body, _ = http_request("POST", f"{BASE}/api/translate",
            body={"text": "Hello world", "targetLang": "zh"},
            headers={"Content-Type": "application/json"},
            timeout=60)
        check("POST /api/translate", 200, code)
        log(f"    响应: {body[:200]}")
        log("")

        # ── 9. /api/vision ─────────────────────────────────────────────
        log("【9/12】图片提问 /api/vision")
        # 1x1 红点 PNG
        img_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        code, body, _ = http_request("POST", f"{BASE}/api/vision",
            body={"question": "What is in this image?", "image": f"data:image/png;base64,{img_b64}"},
            headers={"Content-Type": "application/json"},
            timeout=60)
        check("POST /api/vision", 200, code)
        log(f"    响应: {body[:200]}")
        log("")

        # ── 10. /api/llm-test ──────────────────────────────────────────
        log("【10/12】LLM 测试 /api/llm-test")
        code, body, _ = http_request("POST", f"{BASE}/api/llm-test",
            body={
                "provider": "deepseek",
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": "say hi"}]
            },
            headers={"Content-Type": "application/json"},
            timeout=60)
        check("POST /api/llm-test", 200, code)
        log(f"    响应: {body[:200]}")
        log("")

        # ── 11. /api/feedback ──────────────────────────────────────────
        log("【11/12】反馈 /api/feedback")
        # 必须用真实 chatLogId, 否则路由返回 404
        if chat_log_id:
            code, body, _ = http_request("POST", f"{BASE}/api/feedback",
                body={"type": "up", "chatLogId": chat_log_id, "reason": "E2E test"},
                headers={"Content-Type": "application/json"},
                cookies=cookies)
            check("POST /api/feedback", 200, code)
            log(f"    响应: {body[:200]}")
        else:
            log("  ⚠️  跳过 feedback 测试 (没有 chatLogId)")
        log("")

        # ── 12. 登出 ───────────────────────────────────────────────────
        log("【12/12】登出 /api/auth/signout")
        code, body, _ = http_request("GET", f"{BASE}/api/auth/signout", cookies=cookies)
        check("GET /api/auth/signout", 200, code)
        log("")

    finally:
        # 清理 dev server 进程组
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            time.sleep(1)
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            pass

    # ── 汇总 ──────────────────────────────────────────────────────────
    log("=" * 60)
    log(f"汇总: ✅ {PASS} 通过  ❌ {FAIL} 失败")
    if FAIL > 0:
        log("")
        log("失败项:")
        for f in FAILURES:
            log(f"  - {f}")
    log("=" * 60)
    return FAIL


if __name__ == "__main__":
    sys.exit(main())
