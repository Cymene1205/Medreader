# MedReader Agent — 部署到服务器

> 目标服务器：阿里云 ECS `47.253.133.131`（2 vCPU / 2 GiB / 40 GiB ESSD）
> 部署方式：Docker Compose
> 访问方式：`http://47.253.133.131:3000`

---

## 文件清单

部署涉及以下文件（全部已生成）：

| 文件 | 作用 |
|------|------|
| `Dockerfile` | 多阶段构建：deps → builder → runner。最终镜像基于 `node:20-alpine` + `bun` + `tini` |
| `docker-compose.yml` | 启动配置：端口 3000:3000，挂载 `./data` 和 `./uploads` |
| `.dockerignore` | 排除 `node_modules` / `.next` / `db` / `uploads` 等 |
| `.env.production.example` | env 模板，复制为 `.env.production` 后填写实际值 |
| `.env.production` | 已自动生成（含随机 NEXTAUTH_SECRET + 服务器 IP） |
| `deploy.sh` | 一键部署脚本：装 Docker → 同步代码 → 迁移数据 → 构建启动 |

---

## 部署方式 A：一键脚本（推荐）

如果你能把代码 push 到 Git 仓库（GitHub/Gitee/自建 Git），最快的方式是：

```bash
# 1. SSH 登录服务器
ssh root@47.253.133.131

# 2. 克隆仓库到 /opt/medreader
sudo mkdir -p /opt/medreader
sudo chown $USER /opt/medreader
git clone <your-repo-url> /opt/medreader
cd /opt/medreader

# 3. 运行部署脚本
bash deploy.sh
```

脚本会自动：
1. 检测并安装 Docker（如果没有）
2. 创建 `.env.production`（含随机 NEXTAUTH_SECRET）
3. 把现有 `db/custom.db`（如果有）复制到 `./data/`
4. `docker compose up -d --build`（首次 2-5 分钟）
5. 等待健康检查通过，打印访问地址

完成后访问 `http://47.253.133.131:3000`。

---

## 部署方式 B：手动步骤

如果你不想用脚本，或想完全控制每一步：

### B.1 SSH 到服务器

```bash
ssh root@47.253.133.131
```

### B.2 安装 Docker（如果没有）

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version  # 验证
docker compose version  # 验证 compose v2
```

### B.3 把代码弄到服务器

**方式 1：Git clone**
```bash
git clone <your-repo-url> /opt/medreader
cd /opt/medreader
```

**方式 2：本地打包上传（如果没用 Git）**

在本地（开发机）：
```bash
cd /home/z/my-project
tar --exclude='node_modules' --exclude='.next' --exclude='db' \
    --exclude='uploads' --exclude='.git' \
    -czf medreader.tar.gz .
scp medreader.tar.gz root@47.253.133.131:/opt/
```

在服务器：
```bash
mkdir -p /opt/medreader && cd /opt/medreader
tar xzf /opt/medreader.tar.gz
```

### B.4 准备 .env.production

```bash
cd /opt/medreader
cp .env.production.example .env.production

# 生成随机 NEXTAUTH_SECRET 并写入
SECRET=$(openssl rand -base64 32)
sed -i "s|NEXTAUTH_SECRET=PLEASE_REPLACE_WITH_RANDOM_32_BYTES|NEXTAUTH_SECRET=$SECRET|" .env.production

# 设置 NEXTAUTH_URL 为你的服务器 IP
sed -i "s|NEXTAUTH_URL=http://.*|NEXTAUTH_URL=http://47.253.133.131:3000|" .env.production

# （可选）填入正式 API Key
# vi .env.production  # 编辑 DEEPSEEK_API_KEY / MINERU_API_TOKEN
```

### B.5 迁移现有数据（可选）

如果你想把开发环境的用户账号和论文历史一起搬过去：

```bash
# 在本地开发机：
scp -r /home/z/my-project/db root@47.253.133.131:/opt/medreader/db
scp -r /home/z/my-project/uploads root@47.253.133.131:/opt/medreader/uploads

# 在服务器：
cd /opt/medreader
mkdir -p data
cp db/custom.db data/custom.db
# uploads/ 已经在原位
```

### B.6 构建并启动

```bash
cd /opt/medreader
docker compose up -d --build
```

首次构建大约 2-5 分钟。完成后：

```bash
# 查看日志
docker compose logs -f

# 看运行状态
docker compose ps
```

### B.7 验证访问

打开浏览器访问 `http://47.253.133.131:3000`，应该能看到 MedReader 首页。

---

## 常用运维命令

```bash
cd /opt/medreader

# 查看实时日志
docker compose logs -f

# 重启容器（改了 .env.production 后用）
docker compose restart

# 拉新代码 + 重新构建 + 重启
git pull && docker compose up -d --build

# 停止
docker compose down

# 进入容器调试
docker compose exec medreader sh

# 备份数据库
cp data/custom.db "data/custom.db.$(date +%Y%m%d).bak"

# 备份所有数据
tar -czf medreader-backup-$(date +%Y%m%d).tar.gz data/ uploads/ .env.production
```

---

## 阿里云安全组配置

如果浏览器访问 `http://47.253.133.131:3000` 不通，需要到阿里云控制台开放端口：

1. 进入 ECS 实例 `75040d9db5f54d358dc8a0d388d918dd` 详情
2. 左侧菜单 → **安全组** → 配置规则
3. 添加入方向规则：
   - 协议：TCP
   - 端口范围：`3000/3000`
   - 授权对象：`0.0.0.0/0`
   - 优先级：1
   - 描述：MedReader HTTP

---

## 常见问题

### Q1：构建失败 `npm ci` 报 lockfile 不一致
```bash
# 在本地先同步 lockfile
npm install  # 或 bun install
git add package-lock.json bun.lock
git commit -m "sync lockfile"
git push

# 服务器重新拉取并构建
git pull && docker compose up -d --build
```

### Q2：容器启动后访问 502 / 连接超时
- 检查阿里云安全组是否放通 3000 端口（见上节）
- 检查容器是否健康：`docker compose ps`（应显示 `healthy`）
- 看日志：`docker compose logs --tail=100 medreader`

### Q3：内存不够（2 GiB 服务器构建时 OOM）
Docker 构建时 Node + next build 会吃 ~1.5GB。如果 OOM：
```bash
# 方案 1：在本地构建好镜像，导出后上传到服务器
docker build -t medreader:latest .
docker save medreader:latest | gzip > medreader.tar.gz
scp medreader.tar.gz root@47.253.133.131:/opt/
# 服务器上：
docker load < /opt/medreader.tar.gz
docker compose up -d  # 不带 --build

# 方案 2：临时加 swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Q4：上传 PDF 后解析失败
- 检查 `MINERU_API_TOKEN` 是否有效（在 `.env.production` 里设，或依赖源码硬编码默认值）
- 检查容器是否能访问外网：`docker compose exec medreader wget -qO- https://api.deepseek.com | head`
- 看 `docker compose logs` 里的具体错误

### Q5：想换域名 + HTTPS
后续配 Caddy 自动签 Let's Encrypt：
```bash
# 修改 docker-compose.yml，把 ports 改为只监听本地
#   ports:
#     - "127.0.0.1:3000:3000"
# 然后跑 Caddy 容器反代
```

需要时告诉我，我帮你出 Caddy 配置。

---

## 数据持久化

| 路径（容器内） | 路径（宿主机） | 内容 |
|---------------|---------------|------|
| `/app/data/custom.db` | `/opt/medreader/data/custom.db` | SQLite 数据库（用户、论文记录、聊天历史） |
| `/app/uploads/` | `/opt/medreader/uploads/` | 用户上传的 PDF + MinerU 提取的图片 |

**删除容器不会丢数据**，因为这两个目录通过 volume 挂载在宿主机上。只有 `rm -rf data/ uploads/` 才会丢。

---

## 资源占用预估

| 项目 | 内存 | CPU |
|------|------|-----|
| Next.js standalone server | ~150-250 MB | 空闲 1-2%，请求时瞬时 10-30% |
| 上传 PDF 解析（MinerU 远程调用） | ~50 MB | 等待时近 0，处理图片时 10% |
| LLM 调用（DeepSeek 远程） | ~30 MB | 主要是网络等待 |
| Docker daemon | ~50 MB | 1-2% |
| **总计** | **~300-400 MB** | **平均 5%** |

2 GiB 服务器留有充足余量。如果将来用户量增长，可升级到 4 GiB 或加 Redis 缓存。
