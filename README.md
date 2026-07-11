# 大厂更新速览（Agent Pulse）

一个**简单、免费**的更新清单页：只看各大厂**新模型 / Agent 工具 / 政策弃用**，每条可点开跳转官网原文。

## 原则

- 只使用 GitHub、npm 和厂商官方发布说明页；没有付费 X API 时不自动抓取或转载 X 内容。
- 每小时检查，脚本根据 UTC 的严格 5 小时时间槽记录星数快照；数据未变化时不会提交。
- 解析异常保留上次有效数据，并在页面上显示来源状态。模型官方页发生无法确定的变动时，只标为“待核验”，不会伪造发布事件。

## 日常使用

```bash
npm install
npm run collect   # 拉取 GitHub / npm / 多官网源，写入 public/data
npm run dev       # 本地预览 http://localhost:5173
npm test
```

### 自动同步链路

1. GitHub Actions 每小时从官方公开来源采集一次，并把新快照提交到 `main` 的 `public/data/`。
2. 页面首次打开时直接读取 GitHub Raw 上的最新快照；远端不可用时才回退到 Pages 随站点部署的本地快照。
3. 页面保持打开时每 10 分钟自动检查一次；重新聚焦窗口、切回标签页或网络恢复时也会立即检查。
4. “同步最新快照”按钮用于立即检查，不负责启动后端采集器。浏览器端不保存 GitHub Token，因此不会泄露仓库写入凭证。

这套链路不依赖数据提交再次触发 Pages 构建：即使 Pages 中的静态 JSON 尚未重新部署，已发布的前端也会读取 `main` 上更新后的公开快照。

### 本地预览（推荐顺序）

1. 安装依赖：`npm install`
2. 采集最新公开数据：`npm run collect`  
   - 纯免费：只请求公开 HTML/RSS/GitHub/npm  
   - 可选：设置环境变量 `GITHUB_TOKEN` 可降低 GitHub API 限流（本地没有也能跑，工具 stars 可能暂时 error）
3. 启动开发服务器：`npm run dev`
4. 浏览器打开终端提示的地址（通常是 `http://localhost:5173`）
5. 页面上可查看：工具脉冲、新模型发布、弃用政策、官网源健康度、待核验事件

GitHub Actions 的 `collect` 工作流会定时刷新 `public/data/`；`deploy-pages` 会把静态的 `dist` 发布到 GitHub Pages。公开部署可稍后再做。

## 模型 / 政策多源（免费）

配置在 `data/sources.json`。每个厂商可挂多个官方 feed（News RSS、Release Notes、Deprecations、Changelog 等）。采集器会：

- 并行检查多家官网公开页
- 解析新模型与弃用/迁移信号
- 解析失败但页面变化时标记为「待核验」
- 在页面上展示 feed 健康度与原文链接

## 静态数据接口

- `public/data/current.json`：首页状态、工具卡、模型/政策摘要、feed 健康
- `public/data/events.json`：已验证事件流（含 model / deprecation / source_changed）
- `public/data/snapshots.json`：星数图表
- `public/data/capabilities.json`：能力雷达的来源化清单
- `public/data/status.json`：采集来源健康度
