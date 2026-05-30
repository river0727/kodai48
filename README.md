
# 48模拟器 - AI聊天游戏

一个模拟偶像养成的小游戏，支持AI智能NPC对话。

## 🚀 快速部署

### 方式一：Railway（推荐）

1. 把这个项目上传到 GitHub
2. 在 Railway 新建项目，导入 GitHub 仓库
3. 在 Railway 设置环境变量：
   - `AI_API_KEY`: 你的 DeepSeek API Key
   - `AI_BASE_URL`: `https://api.deepseek.com/v1`
   - `AI_MODEL`: `deepseek-chat`
4. 等待部署完成，获得后端网址

### 方式二：Vercel（前端）

1. 上传项目到 GitHub
2. 在 Vercel 导入仓库
3. 部署自动完成

## 📝 环境变量

需要在 Railway 中配置：

```
AI_API_KEY=sk-xxxxxx...
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
```

## 📁 项目结构

```
/
├── index.html       # 游戏前端
├── main.py          # 后端服务
├── requirements.txt # Python依赖
└── README.md        # 说明文档
```

## 🌟 功能

- AI智能NPC对话
- 多种角色性格设定
- 本地回退（AI调用失败时）
- 支持跨域

## 🤝 技术栈

- 前端：HTML + JavaScript
- 后端：FastAPI + Uvicorn
- AI：DeepSeek API
