"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Capability, CurrentData, EventRecord, SnapshotSeries, ToolRecord } from "./site-types";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const dataPath = (name: string) => `${basePath}/data/${name}`;
const accent = ["#4ee5d4", "#c7f464", "#ffbf69", "#ff7f6a"];

const emptyData: CurrentData = {
  generated_at: null,
  timezone: "Asia/Shanghai",
  status: "bootstrapping",
  tools: [
    { id: "codex", name: "Codex", repo: "openai/codex", repo_url: "https://github.com/openai/codex", official_url: "https://developers.openai.com/codex", x_url: "https://x.com/OpenAI", stars: null, stars_delta_24h: null, stars_delta_7d: null, latest_release: null, release_cadence_30d: { count: 0, median_days: null }, npm: { package: "@openai/codex", version: null, weekly_downloads: null }, status: "bootstrapping" },
    { id: "claude-code", name: "Claude Code", repo: "anthropics/claude-code", repo_url: "https://github.com/anthropics/claude-code", official_url: "https://code.claude.com/docs", x_url: "https://x.com/AnthropicAI", stars: null, stars_delta_24h: null, stars_delta_7d: null, latest_release: null, release_cadence_30d: { count: 0, median_days: null }, npm: { package: "@anthropic-ai/claude-code", version: null, weekly_downloads: null }, status: "bootstrapping" },
    { id: "agy", name: "AGY", repo: "google-antigravity/antigravity-cli", repo_url: "https://github.com/google-antigravity/antigravity-cli", official_url: "https://www.antigravity.google/docs/cli-using", x_url: "https://x.com/GoogleAI", stars: null, stars_delta_24h: null, stars_delta_7d: null, latest_release: null, release_cadence_30d: { count: 0, median_days: null }, npm: null, status: "bootstrapping" },
    { id: "openclaw", name: "OpenClaw", repo: "openclaw/openclaw", repo_url: "https://github.com/openclaw/openclaw", official_url: "https://openclaw.ai", x_url: "https://x.com/openclaw", stars: null, stars_delta_24h: null, stars_delta_7d: null, latest_release: null, release_cadence_30d: { count: 0, median_days: null }, npm: { package: "openclaw", version: null, weekly_downloads: null }, status: "bootstrapping" },
  ],
  models: [],
};

function formatCount(value: number | null) {
  if (value === null || value === undefined) return "待采集";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "待首次采集";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

function relativeTime(value: string | null) {
  if (!value) return "--";
  const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000));
  return hours < 1 ? "刚刚更新" : hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`;
}

function statusLabel(status: string) {
  return status === "ok" ? "来源健康" : status === "stale" ? "数据延迟" : status === "error" ? "来源待修复" : "首次采集中";
}

function Sparkline({ values, color, label }: { values: number[]; color: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || values.length < 2) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const low = Math.min(...values);
      const high = Math.max(...values);
      const span = Math.max(1, high - low);
      const points = values.map((value, index) => ({ x: (index / (values.length - 1)) * rect.width, y: rect.height - 8 - ((value - low) / span) * (rect.height - 16) }));
      const gradient = context.createLinearGradient(0, 0, 0, rect.height);
      gradient.addColorStop(0, `${color}55`);
      gradient.addColorStop(1, `${color}00`);
      context.beginPath();
      context.moveTo(points[0].x, rect.height);
      points.forEach((point) => context.lineTo(point.x, point.y));
      context.lineTo(points[points.length - 1].x, rect.height);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();
      context.beginPath();
      points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.strokeStyle = color;
      context.lineWidth = 1.6;
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [values, color]);
  return <canvas ref={ref} aria-label={label} role="img" />;
}

function RadarCanvas({ capability }: { capability: Capability | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const axes = useMemo(() => capability?.axes || [], [capability]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || axes.length === 0) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const radius = Math.min(rect.width, rect.height) * 0.34;
      const point = (index: number, scale: number) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / axes.length;
        return { x: cx + Math.cos(angle) * radius * scale, y: cy + Math.sin(angle) * radius * scale };
      };
      context.clearRect(0, 0, rect.width, rect.height);
      [0.25, 0.5, 0.75, 1].forEach((scale) => {
        context.beginPath();
        axes.forEach((_, index) => {
          const p = point(index, scale);
          if (index === 0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        });
        context.closePath();
        context.strokeStyle = "rgba(129,145,152,.28)";
        context.lineWidth = 1;
        context.stroke();
      });
      axes.forEach((axis, index) => {
        const outer = point(index, 1);
        context.beginPath(); context.moveTo(cx, cy); context.lineTo(outer.x, outer.y); context.strokeStyle = "rgba(129,145,152,.24)"; context.stroke();
        const label = point(index, 1.24);
        context.fillStyle = "#819198"; context.font = "10px Cascadia Mono, monospace";
        context.textAlign = label.x < cx - 4 ? "right" : label.x > cx + 4 ? "left" : "center";
        context.fillText(axis.name, label.x, label.y + 3);
      });
      context.beginPath();
      axes.forEach((axis, index) => {
        const p = point(index, axis.count / 4);
        if (index === 0) context.moveTo(p.x, p.y);
        else context.lineTo(p.x, p.y);
      });
      context.closePath(); context.fillStyle = "rgba(78,229,212,.18)"; context.strokeStyle = "#4ee5d4"; context.lineWidth = 1.5; context.fill(); context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [axes]);
  return <canvas ref={ref} role="img" aria-label={`${capability?.tool_name || "工具"}能力覆盖雷达`} />;
}

export function AgentPulseClient() {
  const [current, setCurrent] = useState<CurrentData>(emptyData);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotSeries[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [filter, setFilter] = useState("all");
  const [range, setRange] = useState(30);
  const [activeTool, setActiveTool] = useState("codex");

  useEffect(() => {
    Promise.all([
      fetch(dataPath("current.json")).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(dataPath("events.json")).then((response) => response.ok ? response.json() : []),
      fetch(dataPath("snapshots.json")).then((response) => response.ok ? response.json() : []),
      fetch(dataPath("capabilities.json")).then((response) => response.ok ? response.json() : []),
    ]).then(([nextCurrent, nextEvents, nextSnapshots, nextCapabilities]) => {
      setCurrent(nextCurrent); setEvents(nextEvents); setSnapshots(nextSnapshots); setCapabilities(nextCapabilities);
    }).catch(() => undefined);
  }, []);

  const visibleEvents = useMemo(() => events.filter((event) => filter === "all" || (filter === "model" ? event.type === "model" || event.type === "deprecation" : event.item_id === filter)).slice(0, 6), [events, filter]);
  const activeCapability = capabilities.find((capability) => capability.tool_id === activeTool) || capabilities[0];
  const highestMomentum = current.tools.filter((tool) => tool.stars_delta_24h !== null).sort((a, b) => (b.stars_delta_24h || 0) - (a.stars_delta_24h || 0))[0];
  const latestModel = current.models.filter((model) => model.occurred_at).sort((a, b) => new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime())[0];

  return <main className="pulse-shell"><div className="pulse-page">
    <header className="topline"><a className="brand" href="#overview" aria-label="Agent Pulse 首页"><span className="brand-mark" />AGENT PULSE</a><div className="topline-right"><div className="source-state"><span className={`state-dot ${current.status === "ok" ? "" : current.status === "error" ? "error" : "warn"}`} /><span>{statusLabel(current.status)}</span></div></div></header>
    <section className="hero" id="overview"><div><p className="eyebrow">AI / AGENT INTELLIGENCE DESK</p><h1>不是热搜。<br />是<span>可验证的脉冲。</span></h1><p className="hero-copy">追踪 GPT、Claude、Gemini 和四个核心 Agent 工具的发布、热度与能力覆盖。每个变化都保留来源、时间与健康状态。</p></div><div className="hero-signal"><div className="signal-label">LAST SUCCESSFUL COLLECTION</div><div className="signal-number">{relativeTime(current.generated_at)}</div><div className="signal-detail">以北京时间呈现，原始快照统一使用 UTC。数据变化才会写入仓库历史。</div></div></section>
    <section className="insight-grid" aria-label="今日情报概览"><Insight label="新发布" value={events.filter((event) => event.type === "release").length} copy="已归档的工具版本事件" /><Insight label="24H 动量" value={highestMomentum?.name || "待采集"} copy={highestMomentum?.stars_delta_24h ? `+${formatCount(highestMomentum.stars_delta_24h)} stars` : "等待第一个完整快照"} /><Insight label="最近模型信号" value={latestModel?.name || "待采集"} copy={latestModel ? formatDate(latestModel.occurred_at) : "官方说明页会被定时检查"} /><Insight label="采集覆盖" value={`${current.tools.filter((tool) => tool.status === "ok").length}/${current.tools.length}`} copy="工具来源当前健康" /></section>
    <section><div className="section-heading"><div><div className="section-kicker">LIVE TOOL TRACKER</div><h2>工具脉冲</h2></div><div className="time-switch" aria-label="图表时间范围">{[7, 30, 90].map((value) => <button key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value}D</button>)}</div></div><div className="tool-grid">{current.tools.map((tool, index) => { const series = snapshots.find((snapshot) => snapshot.tool_id === tool.id)?.points || []; return <ToolCard key={tool.id} tool={tool} color={accent[index]} values={series.slice(-Math.max(2, range)).map((point) => point.stars)} onSelect={() => setActiveTool(tool.id)} />; })}</div></section>
    <section className="lower-grid"><div className="events-panel"><div className="section-heading"><div><div className="section-kicker">VERIFIED EVENT STREAM</div><h2>更新流</h2></div><div className="filter-row" aria-label="更新流筛选">{[["all", "全部"], ["model", "模型"], ["codex", "Codex"], ["claude-code", "Claude"], ["agy", "AGY"], ["openclaw", "OpenClaw"]].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div></div><ol className="event-list">{visibleEvents.length ? visibleEvents.map((event) => <li className="event-item" key={event.id}><span className="event-type">{event.type === "release" ? "RELEASE" : event.type === "model" ? "MODEL" : event.type.toUpperCase()}</span><a className="event-title" href={event.source_url} target="_blank" rel="noreferrer">{event.title}</a><time className="event-time">{formatDate(event.occurred_at)}</time></li>) : <li className="empty-state">首次采集完成后，经过验证的发布事件会出现在这里。</li>}</ol></div><div className="radar-panel"><div className="section-kicker">AUDITABLE CAPABILITY COVERAGE</div><div className="capability-heading"><h2>{activeCapability?.tool_name || "能力雷达"}</h2><select value={activeTool} onChange={(event) => setActiveTool(event.target.value)} aria-label="选择工具">{current.tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</select></div><div className="radar-wrap"><RadarCanvas capability={activeCapability} /></div><div className="capability-list">{activeCapability?.axes.map((axis) => <div className="capability-line" key={axis.id}><span className="capability-name">{axis.name}</span><span className="capability-meter">{[0, 1, 2, 3].map((index) => <span className={`capability-segment ${index < axis.count ? "active" : ""}`} key={index} />)}</span></div>)}</div></div></section>
    <section className="model-section"><div className="section-heading"><div><div className="section-kicker">OFFICIAL MODEL WATCH</div><h2>模型发布与迁移提醒</h2></div></div><div className="model-grid">{current.models.map((model) => <a className="model-panel" key={model.id} href={model.source_url} target="_blank" rel="noreferrer"><div className="model-provider">{model.provider}</div><div className="model-title">{model.title || "官方来源正在等待首次解析"}</div><div className="model-date">{formatDate(model.occurred_at)}</div></a>)}</div><div className="x-watch-panel"><div className="x-watch"><div><div className="section-kicker">X WATCH DESK</div><div className="x-watch-copy">不采集、不转载、不规避平台限制。这里仅保留官方账号与精确搜索入口，用于你自己核验最快信号。</div></div><a href="https://x.com/search?q=%28from%3AOpenAI%20OR%20from%3AAnthropicAI%20OR%20from%3AGoogleAI%29%20%28Codex%20OR%20Claude%20OR%20Antigravity%29&f=live" target="_blank" rel="noreferrer">OPEN X WATCH ↗</a></div></div></section>
  </div></main>;
}

function Insight({ label, value, copy }: { label: string; value: string | number; copy: string }) { return <div className="insight"><div className="card-label">{label}</div><div className="insight-value">{value}</div><div className="insight-copy">{copy}</div></div>; }

function ToolCard({ tool, color, values, onSelect }: { tool: ToolRecord; color: string; values: number[]; onSelect: () => void }) {
  return <article className="tool-card" onMouseEnter={onSelect} onFocus={onSelect} tabIndex={0}><div className="tool-card-top"><span className="tool-meta">{tool.repo}</span><span className={`state-dot ${tool.status === "ok" ? "" : "warn"}`} /></div><h3 className="tool-name">{tool.name}</h3><div className="tool-version">{tool.latest_release?.tag || tool.npm?.version || "等待发布信号"}</div><div className="spark-wrap">{values.length > 1 ? <Sparkline values={values} color={color} label={`${tool.name} 星标趋势`} /> : <div className="empty-state">等待两个以上星数快照</div>}</div><div className="metric-row"><Metric label="STARS" value={formatCount(tool.stars)} /><Metric label="24H" value={tool.stars_delta_24h === null ? "--" : `+${formatCount(tool.stars_delta_24h)}`} positive /><Metric label="30D 发布" value={tool.release_cadence_30d.count || "--"} /></div><div className="tool-card-bottom"><div className="source-links"><a href={tool.repo_url} target="_blank" rel="noreferrer">GITHUB ↗</a><a href={tool.official_url} target="_blank" rel="noreferrer">SOURCE ↗</a><a href={tool.x_url} target="_blank" rel="noreferrer">X ↗</a></div></div></article>;
}

function Metric({ label, value, positive = false }: { label: string; value: string | number; positive?: boolean }) { return <div><div className="metric-label">{label}</div><div className={`metric-value ${positive ? "delta-positive" : "delta-muted"}`}>{value}</div></div>; }
