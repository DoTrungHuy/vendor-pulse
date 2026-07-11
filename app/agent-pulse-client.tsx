"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CurrentData, EventRecord } from "./site-types";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const dataPath = (name: string) => `${basePath}/data/${name}`;

const HERO_VIDEO = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_080021_d598092b-c4c2-4e53-8e46-94cf9064cd50.mp4";
const SIGNALS_VIDEO = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_094631_d30ab262-45ee-4b7d-99f3-5d5848c8ef13.mp4";

type ItemKind = "model" | "agent" | "notice";
type TabId = "models" | "agents" | "notices";

type FeedItem = {
  id: string;
  vendor: string;
  title: string;
  note: string;
  time: string | null;
  href: string;
  isPortal?: boolean;
  topic?: string;
};

const OFFICIAL_NOTICES: FeedItem[] = [
  {
    id: "notice-openai-lifecycle",
    vendor: "OpenAI",
    topic: "生命周期",
    title: "模型与接口：哪些在淘汰、建议换成什么？",
    note: "停用日期和推荐替代都在这页，做迁移时先看它。",
    time: null,
    href: "https://developers.openai.com/api/docs/deprecations",
    isPortal: true,
  },
  {
    id: "notice-openai-release-notes",
    vendor: "OpenAI",
    topic: "产品变更",
    title: "ChatGPT / 模型发布说明",
    note: "默认模型切换、功能调整，常先出现在帮助中心。",
    time: null,
    href: "https://help.openai.com/en/articles/9624314-model-release-notes",
    isPortal: true,
  },
  {
    id: "notice-openai-changelog",
    vendor: "OpenAI",
    topic: "API 变更",
    title: "API 更新日志",
    note: "开发者侧能力与参数变化，比新闻稿更细。",
    time: null,
    href: "https://developers.openai.com/api/docs/changelog",
    isPortal: true,
  },
  {
    id: "notice-openai-usage",
    vendor: "OpenAI",
    topic: "使用政策",
    title: "使用政策",
    note: "能做什么、不能做什么；改版不频繁，但一改就重要。",
    time: null,
    href: "https://openai.com/policies/usage-policies/",
    isPortal: true,
  },
  {
    id: "notice-anthropic-lifecycle",
    vendor: "Anthropic",
    topic: "生命周期",
    title: "Claude 模型状态与替换建议",
    note: "看 Active / Legacy / Deprecated，以及官方推荐怎么换。",
    time: null,
    href: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
    isPortal: true,
  },
  {
    id: "notice-anthropic-platform",
    vendor: "Anthropic",
    topic: "平台更新",
    title: "Claude 平台更新说明",
    note: "API、控制台、SDK 与模型相关通知常写在同一页。",
    time: null,
    href: "https://platform.claude.com/docs/en/release-notes/overview",
    isPortal: true,
  },
  {
    id: "notice-google-deprecations",
    vendor: "Google",
    topic: "生命周期",
    title: "Gemini 弃用时间表",
    note: "预览版和部分生成模型何时停，集中列在这里。",
    time: null,
    href: "https://ai.google.dev/gemini-api/docs/deprecations",
    isPortal: true,
  },
  {
    id: "notice-google-changelog",
    vendor: "Google",
    topic: "API 变更",
    title: "Gemini API 更新日志",
    note: "上新、能力调整和弃用公告，很多会先写进 changelog。",
    time: null,
    href: "https://ai.google.dev/gemini-api/docs/changelog",
    isPortal: true,
  },
  {
    id: "notice-google-models",
    vendor: "Google",
    topic: "模型目录",
    title: "当前可用模型一览",
    note: "现在能调哪些、预览版限制如何，比零散新闻清楚。",
    time: null,
    href: "https://ai.google.dev/gemini-api/docs/models",
    isPortal: true,
  },
];

const emptyCurrent: CurrentData = {
  generated_at: null,
  timezone: "Asia/Shanghai",
  status: "bootstrapping",
  tools: [],
  models: [],
};

function cleanTitle(raw: string) {
  return raw
    .replace(/^[^:]+:\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF]/g, "")
    .trim();
}

function displayTitle(raw: string, max = 100) {
  const title = cleanTitle(raw);
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const pause = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "), cut.lastIndexOf("！"), cut.lastIndexOf(", "));
  return `${(pause > 36 ? cut.slice(0, pause) : cut).trim()}…`;
}

function isConcreteNotice(title: string) {
  const text = cleanTitle(title);
  if (text.length < 28 || text.length > 260) return false;
  const noise = [
    /see which .* are active/i,
    /this page lists/i,
    /anthropic uses the following terms/i,
    /\bactive:\s*the model is fully supported/i,
    /\blegacy:\s*the model will no longer/i,
    /\bdeprecated:\s*the model is still functional/i,
    /\boverview\b/i,
    /copy page/i,
    /\bpalette\b/i,
  ];
  if (noise.some((pattern) => pattern.test(text))) return false;
  const hasSignal = /(deprecat|retir|shutdown|shut down|sunset|no longer|will be removed|migrate|replacement|default model|下线|弃用|迁移|替代)/i.test(text);
  const hasModel = /\b(gpt[-\s]?\d|o[1-9]\b|claude|gemini|imagen|sonnet|opus|haiku|flash|codex|veo)\b/i.test(text);
  const hasDate = /\b(20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text);
  return hasSignal && (hasModel || hasDate);
}

function vendorOf(name: string, provider?: string | null) {
  const text = `${provider || ""} ${name}`.toLowerCase();
  if (text.includes("openai") || text.includes("gpt") || text.includes("codex")) return { label: "OpenAI" };
  if (text.includes("anthropic") || text.includes("claude")) return { label: "Anthropic" };
  if (text.includes("google") || text.includes("gemini") || text.includes("agy")) return { label: "Google" };
  if (text.includes("openclaw")) return { label: "OpenClaw" };
  return { label: provider || name || "其他" };
}

function whereFrom(url: string) {
  const value = url.toLowerCase();
  if (value.includes("github.com")) return "GitHub";
  if (value.includes("/news") || value.includes("rss")) return "官网新闻";
  if (value.includes("deprecat") || value.includes("migration")) return "官方说明页";
  if (value.includes("changelog") || value.includes("release-notes")) return "更新日志";
  if (value.includes("docs.") || value.includes("/docs") || value.includes("help.")) return "官方文档";
  return "官网";
}

function writeNote(kind: ItemKind, opts: { product: string; href: string; version?: string | null }) {
  const from = whereFrom(opts.href);
  if (kind === "agent") {
    if (opts.version) return `${opts.product} 出了新版本 ${opts.version}，详情在 ${from}`;
    return `${opts.product} 有新版本，可到 ${from} 查看`;
  }
  if (from === "官网新闻") return `${opts.product} 的公开模型消息，来自新闻页`;
  if (from === "更新日志") return `${opts.product} 在更新日志里提到的模型变化`;
  return `${opts.product} 的模型动态，来自 ${from}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "官网入口";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function relativeTime(value: string | null) {
  if (!value) return "尚未同步";
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (mins < 1) return "刚刚同步";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function statusText(status: string) {
  if (status === "ok") return "数据在线";
  if (status === "stale") return "部分延迟";
  if (status === "error") return "部分异常";
  return "准备中";
}

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function dedupeItems(items: FeedItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.vendor}|${item.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortByTime(items: FeedItem[]) {
  return [...items].sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
}

function eventToItem(event: EventRecord): FeedItem | null {
  if (!isHttpUrl(event.source_url)) return null;
  const kind: ItemKind = event.type === "release" ? "agent" : event.type === "deprecation" ? "notice" : "model";
  if (kind === "notice" && !isConcreteNotice(event.title)) return null;
  const vendor = vendorOf(event.item_name, event.provider);
  const product = event.item_name || vendor.label;
  return {
    id: event.id,
    vendor: vendor.label,
    title: displayTitle(event.title),
    note: writeNote(kind, { product, href: event.source_url }),
    time: event.occurred_at,
    href: event.source_url,
  };
}

function openOfficialLink(url: string) {
  if (!isHttpUrl(url)) return false;
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return true;
  } catch {
    // Fall back to the current tab when a browser blocks a new tab.
  }
  window.location.assign(url);
  return true;
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7m0 0H9m8 0v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.8 12h16.4M12 3.5c2.2 2.4 3.3 5.2 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.2-3.3-8.5S9.8 5.9 12 3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3h14c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2Zm1 14h12l-3.75-5-3 4L9 13l-3 4Z" />
    </svg>
  );
}

function MovieIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6.5 5.75 10H20v8H4V6.5ZM22 4h-4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4Z" />
    </svg>
  );
}

function LightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1Zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7Z" />
    </svg>
  );
}

function FadingVideo({ src, className }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);

  const fadeTo = useCallback((target: number, duration = 500) => {
    const video = videoRef.current;
    if (!video) return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);

    const from = Number.parseFloat(video.style.opacity || "0");
    const startedAt = window.performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      video.style.opacity = String(from + (target - from) * progress);
      if (progress < 1) frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let restartTimer: number | undefined;

    const start = () => {
      fadingOutRef.current = false;
      video.style.opacity = "0";
      void video.play().catch(() => undefined);
      fadeTo(1);
    };
    const fadeBeforeEnd = () => {
      if (fadingOutRef.current || !Number.isFinite(video.duration)) return;
      if (video.duration - video.currentTime <= 0.55 && video.duration - video.currentTime > 0) {
        fadingOutRef.current = true;
        fadeTo(0);
      }
    };
    const restart = () => {
      video.style.opacity = "0";
      restartTimer = window.setTimeout(() => {
        video.currentTime = 0;
        fadingOutRef.current = false;
        void video.play().catch(() => undefined);
        fadeTo(1);
      }, 100);
    };

    video.addEventListener("loadeddata", start);
    video.addEventListener("timeupdate", fadeBeforeEnd);
    video.addEventListener("ended", restart);
    if (video.readyState >= 2) start();

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (restartTimer !== undefined) window.clearTimeout(restartTimer);
      video.removeEventListener("loadeddata", start);
      video.removeEventListener("timeupdate", fadeBeforeEnd);
      video.removeEventListener("ended", restart);
    };
  }, [fadeTo]);

  return <video ref={videoRef} className={className} src={src} autoPlay muted playsInline preload="auto" />;
}

export function AgentPulseClient() {
  const [current, setCurrent] = useState<CurrentData>(emptyCurrent);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>("models");
  const [toast, setToast] = useState<string | null>(null);
  const signalSectionRef = useRef<HTMLElement>(null);

  const loadData = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const [nextCurrent, nextEvents] = await Promise.all([
        fetch(dataPath("current.json")).then((response) => (response.ok ? response.json() : Promise.reject(new Error("current data unavailable")))),
        fetch(dataPath("events.json")).then((response) => (response.ok ? response.json() : [])),
      ]);
      setCurrent(nextCurrent);
      setEvents(Array.isArray(nextEvents) ? nextEvents : []);
      if (manual) setToast("已读取最新本地快照");
    } catch {
      if (manual) setToast("暂时无法更新，已保留当前信号");
    } finally {
      setReady(true);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const models = useMemo(() => {
    const fromEvents = events.filter((event) => event.type === "model").map(eventToItem).filter(Boolean) as FeedItem[];
    const fromCurrent = (current.models || []).flatMap((model) => {
      const signal = model.latest_model;
      const href = signal?.source_url || model.source_url;
      if (!signal?.title || !isHttpUrl(href)) return [];
      const vendor = vendorOf(model.name, model.provider);
      return [{
        id: `current-model-${model.id}`,
        vendor: vendor.label,
        title: displayTitle(signal.title),
        note: writeNote("model", { product: model.name, href }),
        time: signal.occurred_at || model.occurred_at,
        href,
      } satisfies FeedItem];
    });
    return sortByTime(dedupeItems([...fromEvents, ...fromCurrent])).slice(0, 16);
  }, [events, current.models]);

  const agents = useMemo(() => {
    const fromEvents = events.filter((event) => event.type === "release").map(eventToItem).filter(Boolean) as FeedItem[];
    const fromTools = (current.tools || []).flatMap((tool) => {
      if (!tool.latest_release || !isHttpUrl(tool.latest_release.url)) return [];
      const vendor = vendorOf(tool.name);
      const version = tool.latest_release.title || tool.latest_release.tag;
      return [{
        id: `current-tool-${tool.id}`,
        vendor: vendor.label === "其他" ? tool.name : vendor.label,
        title: `${tool.name} ${version}`,
        note: writeNote("agent", { product: tool.name, href: tool.latest_release.url, version: tool.latest_release.tag }),
        time: tool.latest_release.published_at,
        href: tool.latest_release.url,
      } satisfies FeedItem];
    });
    return sortByTime(dedupeItems([...fromEvents, ...fromTools])).slice(0, 16);
  }, [events, current.tools]);

  const notices = OFFICIAL_NOTICES;
  const activeItems = tab === "models" ? models : tab === "agents" ? agents : notices;
  const totalSignals = models.length + agents.length + notices.length;
  const providers = new Set([...models, ...agents, ...notices].map((item) => item.vendor)).size;
  const activeMeta = tab === "models"
    ? { title: "模型发布", label: "模型更新", copy: "汇总厂商官网与发布说明中的新模型和能力变化，每条均可回到官方原文核验。", icon: <ImageIcon />, tags: ["最新发布", "官方来源", "模型更新"] }
    : tab === "agents"
      ? { title: "Agent 工具", label: "工具更新", copy: "跟踪 Agent 工具的正式版本与开源发布，快速确认工作流中值得升级的变化。", icon: <MovieIcon />, tags: ["版本发布", "GitHub", "工具链"] }
      : { title: "弃用与迁移", label: "风险提醒", copy: "集中查看模型停用、接口弃用与迁移说明，为替换和调整提前留出时间。", icon: <LightIcon />, tags: ["弃用迁移", "官方文档", "政策提醒"] };

  const handleOpen = (item: FeedItem) => {
    if (!isHttpUrl(item.href)) {
      setToast("这条没有可用链接");
      return;
    }
    openOfficialLink(item.href);
  };

  const selectFeed = (nextTab: TabId, shouldScroll = false) => {
    setTab(nextTab);
    if (shouldScroll) signalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToSignals = () => signalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (!ready) return <div className="loading">正在连接信号源…</div>;

  const feedCards: Array<{ id: TabId; title: string; count: number; icon: React.ReactNode; tags: string[]; copy: string }> = [
    { id: "models", title: "模型发布", count: models.length, icon: <ImageIcon />, tags: ["新模型", "能力更新", "官方原文"], copy: "汇总 GPT、Claude、Gemini 等官方发布，帮你快速判断哪些模型变化值得关注。" },
    { id: "agents", title: "Agent 工具", count: agents.length, icon: <MovieIcon />, tags: ["正式发版", "GitHub", "npm"], copy: "跟踪 Codex、Claude Code 等工具的版本演进，不错过影响实际工作流的升级。" },
    { id: "notices", title: "弃用与迁移", count: notices.length, icon: <LightIcon />, tags: ["模型停用", "接口弃用", "迁移说明"], copy: "提前发现停用时间和替换建议，避免关键变化临近时才被动处理。" },
  ];

  return (
    <div className="space-page">
      <section className="hero-stage" aria-label="Agent Pulse 概览">
        <FadingVideo className="stage-video hero-video" src={HERO_VIDEO} />

        <header className="floating-nav">
          <button type="button" className="brand-orb liquid-glass" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="返回页面顶部">a</button>
          <nav className="main-nav liquid-glass" aria-label="情报分类">
            <button type="button" onClick={() => selectFeed("models", true)}>模型发布</button>
            <button type="button" onClick={() => selectFeed("agents", true)}>Agent 工具</button>
            <button type="button" onClick={() => selectFeed("notices", true)}>弃用提醒</button>
            <button type="button" className="nav-refresh" onClick={() => void loadData(true)} disabled={isRefreshing}>
              {isRefreshing ? "更新中" : "刷新数据"}<ArrowIcon />
            </button>
          </nav>
          <div className="nav-spacer" aria-hidden="true" />
        </header>

        <div className="hero-content">
          <div className="live-badge liquid-glass reveal reveal-one">
            <span>LIVE</span>
            <p>{statusText(current.status)} · {relativeTime(current.generated_at)}</p>
          </div>
          <h1 className="hero-title reveal reveal-two">见微知著</h1>
          <p className="hero-copy reveal reveal-three">把散落在官网、GitHub 与 npm 的模型发布、Agent 工具更新和弃用提醒，整理成可核验、可直达原文的更新清单。</p>
          <div className="hero-actions reveal reveal-four">
            <button type="button" className="liquid-glass-strong primary-action" onClick={() => void loadData(true)} disabled={isRefreshing}>
              {isRefreshing ? "正在更新" : "读取最新快照"}<ArrowIcon />
            </button>
            <button type="button" className="quiet-action" onClick={scrollToSignals}>查看更新清单<PlayIcon /></button>
          </div>
          <div className="hero-stats reveal reveal-five" aria-label="实时概览">
            <div className="stat-card liquid-glass">
              <ClockIcon />
              <strong>{totalSignals}</strong>
              <span>已收录可验证更新</span>
            </div>
            <div className="stat-card liquid-glass">
              <GlobeIcon />
              <strong>{providers}</strong>
              <span>持续检查的官方来源</span>
            </div>
          </div>
        </div>

        <div className="source-bar reveal reveal-five">
          <span className="liquid-glass">信息直接来自官方公开渠道</span>
          <div><em>OpenAI</em><em>Anthropic</em><em>Google</em><em>GitHub</em><em>npm</em></div>
        </div>
      </section>

      <section ref={signalSectionRef} className="signals-stage" aria-label="情报信号流">
        <FadingVideo className="stage-video signals-video" src={SIGNALS_VIDEO} />
        <div className="signals-content">
          <div className="signals-heading">
            <p>{"// Official update stream"}</p>
            <h2>重要更新，<br />集中抵达。</h2>
          </div>

          <div className="feed-card-grid">
            {feedCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`feed-card liquid-glass ${tab === card.id ? "is-active" : ""}`}
                onClick={() => selectFeed(card.id)}
                aria-pressed={tab === card.id}
              >
                <div className="feed-card-top">
                  <span className="feed-icon liquid-glass">{card.icon}</span>
                  <span className="feed-count">{String(card.count).padStart(2, "0")}</span>
                </div>
                <div className="feed-tags">{card.tags.map((tag) => <span key={tag} className="liquid-glass">{tag}</span>)}</div>
                <div className="feed-card-copy">
                  <h3>{card.title}</h3>
                  <p>{card.copy}</p>
                </div>
              </button>
            ))}
          </div>

          <section className="signal-list liquid-glass" aria-live="polite">
            <div className="signal-list-head">
              <div>
                <p>{"// "}{activeMeta.label}</p>
                <h3>{activeMeta.title}</h3>
              </div>
              <span>{activeItems.length} 条可核验更新</span>
            </div>
            <p className="signal-list-intro">{activeMeta.copy}</p>
            <div className="signal-rows">
              {activeItems.length ? activeItems.map((item) => (
                <button key={item.id} type="button" className="signal-row" onClick={() => handleOpen(item)} title={item.href}>
                  <div>
                    <p className="row-meta"><b>{item.vendor}</b>{item.topic ? <span>{item.topic}</span> : null}<time>{item.isPortal ? "官方入口" : formatDate(item.time)}</time></p>
                    <h4>{item.title}</h4>
                    <p className="row-note">{item.note}</p>
                  </div>
                  <span className="row-open">查看原文<ArrowIcon /></span>
                </button>
              )) : <div className="empty">暂时还没有信号。</div>}
            </div>
          </section>
        </div>
      </section>

      {toast ? <div className="toast liquid-glass" role="status">{toast}</div> : null}
    </div>
  );
}
