# 本地部署和 v0.3.2 升级

## macOS 本地运行

需要 Node.js 22.13+ 或 24+、npm，以及可访问 MinerU 的网络。克隆仓库后：

```sh
cp .env.production.example .env
```

编辑 `.env`，将 `DATABASE_URL` 设为 `file:/你的项目绝对路径/data/local.db`，`UPLOADS_DIR` 设为 `/你的项目绝对路径/uploads`，`NEXTAUTH_URL` 设为 `http://localhost:3000`。用 `openssl rand -hex 32` 生成 `NEXTAUTH_SECRET`，填写 MinerU Token；AI 模型可在网页“模型设置”中配置。

```sh
mkdir -p data uploads
npm ci
npx prisma db push
npm run build
npm run start:local
```

打开网页后注册账号。需要管理员账号时，可以显式指定邮箱、密码运行：

```sh
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='请换成自己的强密码' npx tsx --env-file=.env scripts/create-admin.ts
```

之后可双击 `start-local.command` 启动和打开网页；`stop-local.command` 或 `npm run stop:local` 停止该项目的本地服务。启动脚本只监听本机地址，不会在退出终端时停止。该脚本针对 macOS；Docker 部署继续使用 `docker compose`。

## 已有部署升级

本次新增 Paper.parseMessage 字段。已有数据库应先备份，再同步结构，不能只替换 JavaScript：

```sh
git pull --ff-only
npm ci
npx prisma db push
npm run build
```

确认同步成功后重启本地服务。Docker 的启动命令已经会运行 `prisma db push`，升级时重新构建并启动容器即可。备份方法及服务器配置见 [DEPLOY.md](DEPLOY.md)。不要加 `--accept-data-loss`，若 Prisma 提示数据丢失风险，先检查数据库和结构差异。

## 与 v0.3.0 的差异

- MinerU 云端轮询从 3 分钟改为 15 分钟，前端等待上限从 4 分钟改为 20 分钟；显示创建任务、上传、排队、解析及结果下载阶段。
- 上传成功后保存 batch_id；刷新页面或服务重启后按原任务续查，避免进程内重复运行同一论文。任务恢复以页面状态查询触发，仅适用于同一服务器进程的去重，不是跨进程任务队列。
- 正文和 blocks 先入库，再提取图表、引用，完成后才设置 done。
- 云端失败直接使用本地 PDF.js，不再通过兜底路径重复提交 MinerU；修正 Node worker 路径，拒绝空 Markdown 结果。
- 上传保留无 Content-Type 的 OSS 请求，上传上限 5 分钟；状态查询等其他网络阶段分别设限。
- 上传后保留论文 URL；打开未完成论文会继续等状态，已保存论文可点“生成分析”，无需重新上传。
- 公共 polyfills 文件不再被认证中间件重定向；修正两处类型错误，排除不属于应用的 websocket 示例类型检查。
- 提供 npm 锁文件、macOS 启停入口和受控 MinerU 测试。

## 展示和验证

展示前先解析所需论文，保存 `/app?paperId=...` 链接。保留本机数据库、原 PDF 和提取图片，展示时通过此链接读取结果。只搬数据库而没有上传文件会导致原文和图片缺失。缓存、账号、Token、模型 Key 和本机演示凭据不包含在 GitHub 版本中。

```sh
npm run test:mineru
npx tsc --noEmit
npm run build
```

受控测试使用模拟接口，验证上传头、ZIP/图片提取、任务续查及空结果拒绝；它不证明外部 MinerU 队列可用。2026-10-03 本机真实提交和上传成功，但 VLM 测试及官方 pipeline 示例仍返回 pending；队列等待的具体原因需要 MinerU 侧确认。本地 PDF.js 文字提取、缓存正文/PDF/图片接口和浏览器渲染已验证。图像理解、问答及分析需另外配置并测试模型 API。

## v0.3.2 本地图表兜底

云端失败后，本地 PDF.js 现在保留文字块、页码，并生成包含主图图注的完整原文页面图；页面明确显示解析来源。这不是 OCR，也不是 MinerU 的精确版面或图表裁剪。双栏正文按左右列排列，减少左右文字混在同一行的情况。

已有文字兜底论文可在备份数据库后运行：

```sh
npx tsx --env-file=.env scripts/repair-local-figures.ts PAPER_ID
```

脚本读取原 PDF，重建文字、图表页面和引用，不会覆盖完整 MinerU 结果。刷新后点“重新分析”可按当前内容重算 AI 分析。框选图片问答还需要单独配置“模型设置 → 图像识别”的模型和 Key。

两篇实际医学论文的本地修复分别恢复 6 个和 5 个主图页面。正式版上传、兜底保存和 PNG 图片接口已验证。
