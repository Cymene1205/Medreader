# MedReader Agent

> 让 AI 帮你真正读懂一篇医学文献。

面向医学研究者的 AI 文献阅读 Agent。五面板协同工作区 + 六维度论文分析 + DeepSeek 大模型问答，将 PDF 转化为可对话、可导航、可质疑的知识。

## ✨ 核心功能

- **PDF 原文阅读** — 高保真渲染，选词高亮，跨页定位
- **智能解析** — MinerU Cloud 将 PDF 转换为结构化 Markdown
- **思维导图** — 自动识别层级，Dagre 布局，节点跳转
- **Agent 提问** — DeepSeek 驱动，选段提问，回答可溯源
- **全文框架** — AI 章节识别，段落彩色导航，双向联动
- **六维度分析** — 科学问题 / 论证思路 / 方法与结果 / 逻辑解析 / 创新性 / 局限性

## 🛠 技术栈

- **框架**: Next.js 16 (App Router) + TypeScript 5
- **样式**: Tailwind CSS 4 + shadcn/ui
- **数据库**: Prisma ORM + SQLite
- **认证**: NextAuth.js v4
- **AI**: MinerU Cloud API + DeepSeek-V3
- **部署**: Docker Compose (2 vCPU / 2 GiB 即可)

## 🚀 快速开始

### 环境要求

- Node.js 20+ 或 Bun
- SQLite (已内置)

### 安装

```bash
# 1. 克隆仓库
git clone https://github.com/<YOUR_USERNAME>/medreader-agent.git
cd medreader-agent

# 2. 安装依赖
bun install  # 或 npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填写 NEXTAUTH_SECRET / MINERU_API_TOKEN / DEEPSEEK_API_KEY

# 4. 初始化数据库
bun run db:push

# 5. 创建管理员账号
bun run scripts/create-admin.ts
# 默认: admin@local / admin123456

# 6. 启动开发服务器
bun run dev
```

访问 http://localhost:3000

### Docker 部署

```bash
# 配置环境
cp .env.production.example .env.production
# 编辑 .env.production

# 一键部署
bash deploy.sh
```

详见 [DEPLOY.md](./DEPLOY.md)。

## 📁 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx            # 学术风展示首页
│   ├── app/page.tsx        # 五面板应用工作区
│   ├── login/              # 登录页
│   ├── register/           # 注册页
│   ├── admin/              # 管理后台
│   └── api/                # API 路由
│       ├── upload/         # PDF 上传 + MinerU 解析
│       ├── analyze/        # 六维度结构化分析
│       ├── chat/           # DeepSeek 对话
│       └── auth/           # NextAuth
├── components/
│   ├── landing/            # 学术风展示页组件
│   ├── pdf-viewer.tsx      # PDF 原文阅读
│   ├── block-reader.tsx    # 智能解析
│   ├── mindmap-view.tsx    # 思维导图
│   ├── chat-panel.tsx      # Agent 提问
│   ├── outline-panel.tsx   # 全文框架
│   ├── heading-navigator.tsx # 段落导航
│   └── ui/                 # shadcn/ui 组件
└── lib/
    ├── auth.ts             # NextAuth 配置
    └── db.ts               # Prisma 客户端
```

## 📖 文档

- [项目白皮书](./download/MedReader-Agent-项目白皮书.pdf)
- [部署说明](./DEPLOY.md)

## 👤 作者

**陈禹墨 (Chen Yumo)**
- 华中科技大学 · 同济医学院
- 公众号「行止集」主理人

## 🙏 致谢

本项目得到华中科技大学同济医学院基础医学院的资助与支持。

## 📄 License

MIT License
