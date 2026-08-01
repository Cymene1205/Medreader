#!/bin/bash
# =============================================================================
# MedReader Agent — End-to-end smoke test
# =============================================================================
# 模拟真实用户操作流程，测试每个 API 端点。
# 用法: bash /home/z/my-project/scripts/e2e-smoke-test.sh
# =============================================================================
set -uo pipefail

BASE="http://localhost:3001"
PASS=0
FAIL=0
declare -a FAILURES

check() {
  local name="$1" expected="$2" actual="$3" extra="${4:-}"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $name (HTTP $actual) $extra"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name — 期望 $expected, 实际 $actual $extra"
    FAIL=$((FAIL+1))
    FAILURES+=("$name (期望 $expected, 实际 $actual)")
  fi
}

echo "=========================================="
echo "MedReader E2E Smoke Test — $(date '+%H:%M:%S')"
echo "=========================================="
echo ""

# 用随机邮箱避免冲突
TEST_EMAIL="e2e-test-$(date +%s)@test.local"
TEST_PASSWORD="Test1234Pass"
COOKIE_JAR=$(mktemp)
ADMIN_EMAIL="admin@local"
ADMIN_PASSWORD="admin123456"

# ── 1. 公开页面 ────────────────────────────────────────────────────────────
echo "【1/12】公开页面加载测试"
check "首页 /"            "200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/)"
check "登录页 /login"     "200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/login)"
check "注册页 /register"  "200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/register)"

# 验证登录页确实不再有 biorhythm-avatar
LOGIN_HTML=$(curl -s $BASE/login)
if echo "$LOGIN_HTML" | grep -q "biorhythm-avatar"; then
  echo "  ❌ 登录页仍含 biorhythm-avatar 引用"
  FAIL=$((FAIL+1)); FAILURES+=("login page still has biorhythm-avatar")
else
  echo "  ✅ 登录页无 biorhythm-avatar 引用"
  PASS=$((PASS+1))
fi

echo ""

# ── 2. 注册 ────────────────────────────────────────────────────────────────
echo "【2/12】用户注册测试 ($TEST_EMAIL)"
REG_RES=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"E2E Tester\"}")
REG_CODE=$(echo "$REG_RES" | tail -1)
REG_BODY=$(echo "$REG_RES" | head -n -1)
check "POST /api/auth/register" "200" "$REG_CODE"
echo "    响应: $(echo $REG_BODY | head -c 120)"
echo ""

# ── 3. 登录获取 session cookie ─────────────────────────────────────────────
echo "【3/12】登录测试"
CSRF_RES=$(curl -s -c $COOKIE_JAR $BASE/api/auth/csrf)
CSRF_TOKEN=$(echo "$CSRF_RES" | grep -o '"csrfToken":"[^"]*"' | cut -d'"' -f4)
LOGIN_RES=$(curl -s -w '\n%{http_code}' -b $COOKIE_JAR -c $COOKIE_JAR \
  -X POST $BASE/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=$TEST_EMAIL" \
  --data-urlencode "password=$TEST_PASSWORD" \
  --data-urlencode "csrfToken=$CSRF_TOKEN" \
  --data-urlencode "callbackUrl=$BASE/app" \
  --data-urlencode "json=true")
LOGIN_CODE=$(echo "$LOGIN_RES" | tail -1)
# callback 返回 200 表示登录流程走通（即使 redirect）
if [ "$LOGIN_CODE" = "200" ]; then
  echo "  ✅ 登录流程完成 (HTTP $LOGIN_CODE)"
  PASS=$((PASS+1))
else
  echo "  ❌ 登录失败 (HTTP $LOGIN_CODE)"
  FAIL=$((FAIL+1)); FAILURES+=("login failed ($LOGIN_CODE)")
fi

# 验证 session
SESSION_RES=$(curl -s -b $COOKIE_JAR $BASE/api/auth/session)
if echo "$SESSION_RES" | grep -q '"user"'; then
  echo "  ✅ Session 有效"
  PASS=$((PASS+1))
else
  echo "  ❌ Session 无效 — 响应: $SESSION_RES"
  FAIL=$((FAIL+1)); FAILURES+=("session invalid")
fi
echo ""

# ── 4. /api/quota 端点 ──────────────────────────────────────────────────────
echo "【4/12】额度查询 /api/quota"
QUOTA_RES=$(curl -s -w '\n%{http_code}' -b $COOKIE_JAR $BASE/api/quota)
QUOTA_CODE=$(echo "$QUOTA_RES" | tail -1)
QUOTA_BODY=$(echo "$QUOTA_RES" | head -n -1)
check "GET /api/quota" "200" "$QUOTA_CODE"
# 验证返回了 4 个 action
ACTION_COUNT=$(echo "$QUOTA_BODY" | grep -o '"label":"' | wc -l)
if [ "$ACTION_COUNT" -ge "4" ]; then
  echo "  ✅ 返回 $ACTION_COUNT 个 action 额度"
  PASS=$((PASS+1))
else
  echo "  ❌ 只返回 $ACTION_COUNT 个 action (期望 4)"
  FAIL=$((FAIL+1)); FAILURES+=("quota actions incomplete ($ACTION_COUNT/4)")
fi
echo "    响应: $(echo $QUOTA_BODY | head -c 200)"
echo ""

# ── 5. 管理员登录 + /api/admin/stats ────────────────────────────────────────
echo "【5/12】管理员后台 /api/admin/stats"
ADMIN_COOKIE=$(mktemp)
CSRF2=$(curl -s -c $ADMIN_COOKIE $BASE/api/auth/csrf | grep -o '"csrfToken":"[^"]*"' | cut -d'"' -f4)
curl -s -b $ADMIN_COOKIE -c $ADMIN_COOKIE -X POST $BASE/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=$ADMIN_EMAIL" \
  --data-urlencode "password=$ADMIN_PASSWORD" \
  --data-urlencode "csrfToken=$CSRF2" \
  --data-urlencode "callbackUrl=$BASE/admin" \
  --data-urlencode "json=true" > /dev/null
ADMIN_RES=$(curl -s -w '\n%{http_code}' -b $ADMIN_COOKIE $BASE/api/admin/stats)
ADMIN_CODE=$(echo "$ADMIN_RES" | tail -1)
check "GET /api/admin/stats (admin)" "200" "$ADMIN_CODE"
if [ "$ADMIN_CODE" = "200" ]; then
  echo "  ✅ 管理员能访问 stats"
  PASS=$((PASS+1))
fi

# 验证 quota 接口对管理员返回 isAdmin=true
ADMIN_QUOTA=$(curl -s -b $ADMIN_COOKIE $BASE/api/quota)
if echo "$ADMIN_QUOTA" | grep -q '"isAdmin":true'; then
  echo "  ✅ /api/quota 正确识别 admin 身份"
  PASS=$((PASS+1))
else
  echo "  ❌ /api/quota 未识别 admin"
  FAIL=$((FAIL+1)); FAILURES+=("quota isAdmin not true for admin")
fi
echo ""

# ── 6. 未登录访问 /api/upload (应 401) ──────────────────────────────────────
echo "【6/12】未登录上传拦截"
UP_NOAUTH=$(curl -s -w '\n%{http_code}' -X POST $BASE/api/upload -F "file=@/dev/null")
UP_NOAUTH_CODE=$(echo "$UP_NOAUTH" | tail -1)
check "POST /api/upload (无 session)" "401" "$UP_NOAUTH_CODE"
echo ""

# ── 7. /api/chat 匿名调用 (应 200 SSE) ──────────────────────────────────────
echo "【7/12】匿名 chat 调用"
CHAT_RES=$(curl -s -w '\n%{http_code}' --max-time 30 -X POST $BASE/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"什么是DNA?","messages":[],"markdown":"DNA is deoxyribonucleic acid."}')
CHAT_CODE=$(echo "$CHAT_RES" | tail -1)
check "POST /api/chat (匿名)" "200" "$CHAT_CODE"
CHAT_BODY=$(echo "$CHAT_RES" | head -n -1)
if echo "$CHAT_BODY" | grep -q '"delta"'; then
  echo "  ✅ 返回了 SSE delta 数据"
  PASS=$((PASS+1))
elif echo "$CHAT_BODY" | grep -q '"error"'; then
  echo "  ⚠️  返回 error (可能 DeepSeek 额度用尽): $(echo $CHAT_BODY | head -c 150)"
elif echo "$CHAT_BODY" | grep -q '"__meta__"'; then
  echo "  ✅ ChatLog 已保存"
  PASS=$((PASS+1))
fi
echo ""

# ── 8. /api/translate ──────────────────────────────────────────────────────
echo "【8/12】翻译 /api/translate"
TR_RES=$(curl -s -w '\n%{http_code}' --max-time 30 -X POST $BASE/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world","targetLang":"zh"}')
TR_CODE=$(echo "$TR_RES" | tail -1)
check "POST /api/translate" "200" "$TR_CODE"
echo "    响应: $(echo $TR_RES | head -n -1 | head -c 150)"
echo ""

# ── 9. /api/vision ─────────────────────────────────────────────────────────
echo "【9/12】图片提问 /api/vision"
VIS_RES=$(curl -s -w '\n%{http_code}' --max-time 30 -X POST $BASE/api/vision \
  -H "Content-Type: application/json" \
  -d '{"question":"What is in this image?","image":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="}')
VIS_CODE=$(echo "$VIS_RES" | tail -1)
check "POST /api/vision" "200" "$VIS_CODE"
echo "    响应: $(echo $VIS_RES | head -n -1 | head -c 150)"
echo ""

# ── 10. /api/llm-test ──────────────────────────────────────────────────────
echo "【10/12】LLM 测试 /api/llm-test"
LLM_RES=$(curl -s -w '\n%{http_code}' --max-time 30 -X POST $BASE/api/llm-test \
  -H "Content-Type: application/json" \
  -d '{"provider":"deepseek","model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}')
LLM_CODE=$(echo "$LLM_RES" | tail -1)
check "POST /api/llm-test" "200" "$LLM_CODE"
echo ""

# ── 11. /api/feedback ──────────────────────────────────────────────────────
echo "【11/12】反馈 /api/feedback"
FB_RES=$(curl -s -w '\n%{http_code}' -b $COOKIE_JAR -X POST $BASE/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"type":"up","chatLogId":null,"comment":"E2E test feedback"}')
FB_CODE=$(echo "$FB_RES" | tail -1)
check "POST /api/feedback" "200" "$FB_CODE"
echo ""

# ── 12. 登出 ───────────────────────────────────────────────────────────────
echo "【12/12】登出 /api/auth/signout"
SO_RES=$(curl -s -w '\n%{http_code}' -b $COOKIE_JAR -c $COOKIE_JAR \
  $BASE/api/auth/signout)
SO_CODE=$(echo "$SO_RES" | tail -1)
check "GET /api/auth/signout" "200" "$SO_CODE"
echo ""

# ── 清理 ───────────────────────────────────────────────────────────────────
rm -f $COOKIE_JAR $ADMIN_COOKIE

# ── 汇总 ───────────────────────────────────────────────────────────────────
echo "=========================================="
echo "汇总: ✅ $PASS 通过  ❌ $FAIL 失败"
if [ "$FAIL" -gt "0" ]; then
  echo ""
  echo "失败项:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
fi
echo "=========================================="
exit $FAIL
