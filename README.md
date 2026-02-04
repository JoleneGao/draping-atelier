# 立裁工坊 Draping Atelier

AI 驱动的服装立裁教学平台，帮助零基础用户学习服装立裁技术。

## 项目结构

```
fashion design/
├── index.html          # 前端页面
├── api/
│   └── analyze.js      # Vercel Serverless API 代理
├── vercel.json         # Vercel 配置
├── package.json        # 项目配置
├── .env.example        # 环境变量示例
└── .gitignore          # Git 忽略文件
```

## 部署到 Vercel

### 1. 准备工作

- 注册 [Vercel 账号](https://vercel.com)
- 获取 [Anthropic API Key](https://console.anthropic.com/)

### 2. 部署步骤

#### 方式一：通过 GitHub 部署（推荐）

1. 将项目上传到 GitHub 仓库
2. 登录 Vercel，点击 "Add New Project"
3. 导入你的 GitHub 仓库
4. 在 "Environment Variables" 中添加：
   - `ANTHROPIC_API_KEY` = 你的 Claude API Key
5. 点击 "Deploy"

#### 方式二：通过 Vercel CLI 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 进入项目目录
cd "fashion design"

# 部署
vercel

# 设置环境变量（部署后在 Vercel 控制台设置）
```

### 3. 配置环境变量

在 Vercel 控制台 → 你的项目 → Settings → Environment Variables：

| 变量名 | 值 |
|--------|-----|
| `ANTHROPIC_API_KEY` | sk-ant-api03-xxxxx（你的 API Key） |

**重要**：确保勾选 Production、Preview、Development 三个环境

### 4. 验证部署

部署成功后，访问 Vercel 分配的域名（如 `your-project.vercel.app`），上传一张服装图片测试是否正常工作。

## 本地开发

```bash
# 创建 .env.local 文件
cp .env.example .env.local

# 编辑 .env.local，填入你的 API Key
# ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# 安装 Vercel CLI
npm i -g vercel

# 启动本地开发服务器
vercel dev
```

访问 `http://localhost:3000` 进行测试。

## 安全说明

- API Key 存储在 Vercel 环境变量中，不会暴露给前端
- 前端通过 `/api/analyze` 调用后端代理
- 后端代理转发请求到 Claude API

## 技术栈

- **前端**：原生 HTML/CSS/JavaScript
- **后端**：Vercel Serverless Functions (Node.js)
- **AI**：Claude API (claude-sonnet-4-5-20250929)

## 下一步计划

- [ ] 界面升级（奥雅高级感风格）
- [ ] 教程本地存储功能
- [ ] 材料购买指南
- [ ] 术语词典功能
