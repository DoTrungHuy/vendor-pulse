# Agent Pulse

一个免费、可验证的 AI / Agent 工具追踪站。它追踪 GPT、Claude、Gemini，以及 Codex、Claude Code、AGY 和 OpenClaw 的公开发布、GitHub 热度与发布节奏。

## 原则

- 只使用 GitHub、npm 和厂商官方发布说明页；没有付费 X API 时不自动抓取或转载 X 内容。
- 每小时检查，脚本根据 UTC 的严格 5 小时时间槽记录星数快照；数据未变化时不会提交。
- 解析异常保留上次有效数据，并在页面上显示来源状态。模型官方页发生无法确定的变动时，只标为“待核验”，不会伪造发布事件。

## 日常使用

```bash
npm run dev
npm run collect
npm test
```

GitHub Actions 的 `collect` 工作流会定时刷新 `public/data/`；`deploy-pages` 会把静态的 `dist` 发布到 GitHub Pages。首次推送后，在仓库 Settings 的 Pages 中选择 **GitHub Actions** 作为 Source。

## 静态数据接口

- `public/data/current.json`：首页状态与工具卡
- `public/data/events.json`：已验证事件流
- `public/data/snapshots.json`：星数图表
- `public/data/capabilities.json`：能力雷达的来源化清单
- `public/data/status.json`：采集来源健康度
