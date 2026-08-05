# MedReader 部署手册 — 磁盘清理 + 一键部署

> 目标服务器：阿里云 ECS `47.253.133.131`（2 vCPU / 2 GiB / 40 GiB ESSD）
> 部署方式：本地打包 → scp 上传 → 服务器 Docker 部署
> 访问地址：`http://47.253.133.131:3000`

---

## 你拿到的文件（在 `/home/z/my-project/download/deploy/`）

| 文件 | 用途 |
|------|------|
| `medreader.tar.gz` | 项目代码包（1.4 MB，已排除 node_modules / .next / db / uploads） |
| `cleanup.sh` | 服务器磁盘清理脚本 |
| `deploy-from-tarball.sh` | 服务器部署脚本（从 tar 包部署，不需要 Git） |
| `README-DEPLOY.md` | 本手册 |

---

## 整体流程（3 个阶段）

```
[本地]   打包代码 → scp 上传 3 个文件到服务器 /opt/
[服务器] 清磁盘   → sudo bash cleanup.sh
[服务器] 部署     → sudo bash deploy-from-tarball.sh
[浏览器] 访问     → http://47.253.133.131:3000
```

预计耗时：清理 1 分钟、上传 30 秒、部署 3-5 分钟（首次构建 Docker 镜像）。

---

## 第 1 步：从本地上传到服务器

在你的开发机终端执行（**不是在服务器上**）：

```bash
# 一次性上传 3 个文件到服务器 /opt/
scp /home/z/my-project/download/deploy/medreader.tar.gz \
    /home/z/my-project/download/deploy/cleanup.sh \
    /home/z/my-project/download/deploy/deploy-from-tarball.sh \
    admin@47.253.133.131:/opt/
```

> 如果你的私钥没加进 ssh-agent，加 `-i ~/.ssh/your_key`：
> ```bash
> scp -i ~/.ssh/id_ed25519 \
>     /home/z/my-project/download/deploy/{medreader.tar.gz,cleanup.sh,deploy-from-tarball.sh} \
>     admin@47.253.133.131:/opt/
> ```

---

## 第 2 步：清磁盘

SSH 登服务器，跑清理脚本：

```bash
ssh admin@47.253.133.131
cd /opt
sudo bash cleanup.sh
```

`cleanup.sh` 会做这些事（**不会动用户数据**）：

1. 停止 + 删除所有 Docker 容器和镜像
2. 清 Docker build cache 和悬空 volumes
3. 把 systemd journal 日志裁到 100 MB
4. `apt clean` + `apt autoremove`
5. 删 `/var/log` 下的 `.gz / .1 / .old` 轮转日志
6. 删 `/tmp` 里 7 天前的旧文件
7. 删 `/opt/medreader*.tar.gz`（之前的旧包）
8. 打印清理前后对比 + 释放了多少空间

如果清理后还是 < 1 GiB 可用，脚本会警告并退出。MedReader 构建需要 ~1.5 GiB 临时空间（Docker 镜像层 + npm install）。

排查大文件：
```bash
sudo du -hx --max-depth=2 / 2>/dev/null | sort -rh | head -20
```

---

## 第 3 步：部署

清理完直接接着跑：

```bash
sudo bash deploy-from-tarball.sh
```

脚本会自动：

1. 检测 + 安装 Docker（如果没装）
2. 把 `medreader.tar.gz` 解压到 `/opt/medreader/`
3. 生成 `.env.production`（随机 `NEXTAUTH_SECRET` + 服务器 IP）
4. 如果之前有 `data/` 和 `uploads/`，**自动备份再恢复**（不丢用户数据）
5. `docker compose up -d --build`（首次 3-5 分钟）
6. 等待健康检查通过（最多 2 分钟）
7. 打印访问地址

成功输出长这样：

```
[deploy] ============================================================
[deploy]   MedReader Agent is running
[deploy]   →  http://47.253.133.131:3000
[deploy] ============================================================
```

---

## 第 4 步：浏览器访问

打开 `http://47.253.133.131:3000`，应该看到 MedReader 首页。

### 如果访问不通

1. **先确认容器在跑**：
   ```bash
   ssh admin@47.253.133.131
   docker compose ps               # 应显示 medreader  Up (healthy)
   docker compose logs --tail=50   # 看有没有报错
   ```

2. **去阿里云控制台开放 3000 端口**：
   - ECS 实例 `75040d9db5f54d358dc8a0d388d918dd` 详情
   - 左侧菜单 → 安全组 → 配置规则
   - 入方向：TCP  `3000/3000`  `0.0.0.0/0`  优先级 1

3. **从服务器本机自测**：
   ```bash
   curl -I http://127.0.0.1:3000/   # 应返回 200
   ```

---

## 后续运维

```bash
ssh admin@47.253.133.131
cd /opt/medreader

# 看实时日志
docker compose logs -f

# 改了 .env.production 后重启
docker compose restart

# 拉了新代码包后重新部署（保留数据 + uploads）
sudo bash /opt/deploy-from-tarball.sh

# 停止
docker compose down

# 进入容器调试
docker compose exec medreader sh

# 备份数据库
cp data/custom.db "data/custom.db.$(date +%Y%m%d).bak"

# 全量备份
tar -czf medreader-backup-$(date +%Y%m%d).tar.gz data/ uploads/ .env.production
```

---

## 常见问题

### Q1：构建失败 `npm ci` 报 lockfile 不一致
```bash
cd /opt/medreader
# 项目用 bun.lock 而不是 package-lock.json，Dockerfile 已正确处理
# 如果还报错，删掉 tar 包重传一次：
sudo rm -rf /opt/medreader /opt/medreader.tar.gz
# 然后从本地重新 scp，再 sudo bash /opt/deploy-from-tarball.sh
```

### Q2：容器起来了但 health check 一直 `unhealthy`
```bash
docker compose logs --tail=100 medreader
# 常见原因：
#   1. .env.production 里 NEXTAUTH_URL 写错了 → 改后重启
#   2. Prisma migration 失败 → 查日志里 schema 报错
#   3. 端口被占用 → sudo ss -tlnp | grep 3000
```

### Q3：磁盘又满了
```bash
sudo bash /opt/cleanup.sh           # 重跑清理
docker system df                    # 看 Docker 占了多少
docker compose down                 # 完全停掉容器
docker system prune -af --volumes   # 激进清理（小心，会删所有未挂载的 volume）
```

### Q4：想保留旧数据库重新部署
`deploy-from-tarball.sh` 已经自动做了：
- 部署前：备份 `/opt/medreader/data/` 和 `/opt/medreader/uploads/` 到 tmp
- 解压新代码：清空 `/opt/medreader/`
- 部署后：把备份的 `data/` 和 `uploads/` 恢复回去

所以**直接重跑 `deploy-from-tarball.sh` 是安全的**，不会丢数据。

### Q5：要换域名 / 上 HTTPS
```bash
# 1. 改 .env.production
sudo vi /opt/medreader/.env.production
# NEXTAUTH_URL=https://your-domain.com

# 2. 修改 docker-compose.yml 端口映射（绑定 127.0.0.1，让 Caddy/Nginx 反代）
# ports:
#   - "127.0.0.1:3000:3000"

# 3. 起 Caddy（项目里有 Caddyfile 模板）
sudo apt install caddy
sudo cp /opt/medreader/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy

# 4. 重启容器
cd /opt/medreader && docker compose restart
```

---

## 安全提示

- `cleanup.sh` 不删 `/opt/medreader/data` 和 `/opt/medreader/uploads`
- `deploy-from-tarball.sh` 部署前会自动备份这两个目录
- `.env.production` 不会被 tar 包覆盖（独立排除）
- 服务器 SSH 仍用你的 ed25519 公钥（`admin@medreader-server`）认证
- Docker 容器以 `node:20-alpine` 非 root 用户跑，限制了 1.5 GiB 内存 + 1.5 CPU

---

## TL;DR（最短路径）

```bash
# 本地
scp /home/z/my-project/download/deploy/{medreader.tar.gz,cleanup.sh,deploy-from-tarball.sh} \
    admin@47.253.133.131:/opt/

# 服务器
ssh admin@47.253.133.131
cd /opt
sudo bash cleanup.sh
sudo bash deploy-from-tarball.sh

# 浏览器
# http://47.253.133.131:3000
```
