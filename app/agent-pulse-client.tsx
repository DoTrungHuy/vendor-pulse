"use client";

import { useEffect, useMemo, useState } from "react";
import type { CurrentData, EventRecord } from "./site-types";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const dataPath = (name: string) => `${basePath}/data/${name}`;

type ItemKind = "model" | "agent" | "notice";

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

type TabId = "models" | "agents" | "notices";

const OFFICIAL_NOTICES: FeedItem[] = [
  {
    id: "notice-openai-lifecycle",
    vendor: "OpenAI",
    topic: "生命周期",
    title: "模型与接口：哪些在淘汰、建议换成什么",
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
    note: "能做什么、不能做什么；改版不频，但一改就重要。",
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
  const pause = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "), cut.lastIndexOf("，"), cut.lastIndexOf(", "));
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
  const u = url.toLowerCase();
  if (u.includes("github.com")) return "GitHub";
  if (u.includes("/news") || u.includes("rss")) return "官网新闻";
  if (u.includes("deprecat") || u.includes("migration")) return "官方说明页";
  if (u.includes("changelog") || u.includes("release-notes")) return "更新日志";
  if (u.includes("docs.") || u.includes("/docs") || u.includes("help.")) return "官方文档";
  return "官网";
}

function writeNote(kind: ItemKind, opts: { product: string; href: string; version?: string | null }) {
  const from = whereFrom(opts.href);
  if (kind === "agent") {
    if (opts.version) return `${opts.product} 出了新版本 ${opts.version}，详情在 ${from}`;
    return `${opts.product} 有新版本，可到 ${from} 查看`;
  }
  if (from === "官网新闻") return `${opts.product} 的公开模型消息，来自新闻稿`;
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
  if (status === "ok") return "正常";
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
  const kind: ItemKind =
    event.type === "release" ? "agent" : event.type === "deprecation" ? "notice" : "model";
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
    // fallback
  }
  window.location.assign(url);
  return true;
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AgentPulseClient() {
  const [current, setCurrent] = useState<CurrentData>(emptyCurrent);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<TabId>("models");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(dataPath("current.json")).then((response) => (response.ok ? response.json() : Promise.reject())),
      fetch(dataPath("events.json")).then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([nextCurrent, nextEvents]) => {
        setCurrent(nextCurrent);
        setEvents(Array.isArray(nextEvents) ? nextEvents : []);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

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
        note: writeNote("agent", {
          product: tool.name,
          href: tool.latest_release.url,
          version: tool.latest_release.tag,
        }),
        time: tool.latest_release.published_at,
        href: tool.latest_release.url,
      } satisfies FeedItem];
    });
    return sortByTime(dedupeItems([...fromEvents, ...fromTools])).slice(0, 16);
  }, [events, current.tools]);

  const notices = OFFICIAL_NOTICES;
  const activeItems = tab === "models" ? models : tab === "agents" ? agents : notices;

  const activeMeta = tab === "models"
    ? { title: "新模型", empty: "暂时还没有模型更新。", hint: null as string | null }
    : tab === "agents"
      ? { title: "Agent 工具", empty: "暂时还没有工具发版。", hint: null }
      : {
          title: "官方提醒",
          empty: "暂无入口。",
          hint: "生命周期、迁移、API 变更、使用政策——直接打开各厂说明页。",
        };

  const handleOpen = (item: FeedItem) => {
    if (!isHttpUrl(item.href)) {
      setToast("这条没有可用链接");
      return;
    }
    openOfficialLink(item.href);
  };

  if (!ready) {
    return <div className="loading">加载中…</div>;
  }

  return (
    <div className="page">
      <div className="shell">
        <header className="top">
          <div className="brand">
            <div className="brand-mark glass" aria-hidden>
              <i />
            </div>
            <div>
              <div className="brand-name">脉搏速递</div>
              <div className="brand-sub">大厂模型 · 工具 · 官方提醒</div>
            </div>
          </div>
          <div className="status glass">
            <span className={`dot ${current.status === "ok" ? "" : current.status === "error" ? "bad" : "warn"}`} />
            {statusText(current.status)} · {relativeTime(current.generated_at)}
          </div>
        </header>

        <section className="hero glass">
          <div className="hero-badge glass">
            <b>Live</b>
            点一条，打开官网原文
          </div>
          <h1>先知道变化，再决定要不要跟</h1>
          <p>新模型、Agent 发版和官方说明入口，收成一份能点开的清单。</p>
          <div className="tabs" role="tablist" aria-label="内容分类">
            <button type="button" className={`tab ${tab === "models" ? "is-on" : ""}`} onClick={() => setTab("models")}>
              新模型 {models.length}
            </button>
            <button type="button" className={`tab ${tab === "agents" ? "is-on" : ""}`} onClick={() => setTab("agents")}>
              工具 {agents.length}
            </button>
            <button type="button" className={`tab ${tab === "notices" ? "is-on" : ""}`} onClick={() => setTab("notices")}>
              官方提醒 {notices.length}
            </button>
          </div>
        </section>

        <section className="panel glass" aria-live="polite">
          <div className="panel-head">
            <h2 className="panel-title">{activeMeta.title}</h2>
            <div className="panel-count">{activeItems.length} 条</div>
          </div>
          {activeMeta.hint ? <p className="panel-hint">{activeMeta.hint}</p> : null}

          <div className="list">
            {activeItems.length ? activeItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="row"
                onClick={() => handleOpen(item)}
                title={item.href}
              >
                <div>
                  <div className="row-top">
                    <span className="vendor">{item.vendor}</span>
                    {item.topic ? (
                      <>
                        <span className="sep" aria-hidden />
                        <span className="meta">{item.topic}</span>
                      </>
                    ) : null}
                    <span className="sep" aria-hidden />
                    <span className="meta">{item.isPortal ? "官网" : formatDate(item.time)}</span>
                  </div>
                  <p className="row-title">{item.title}</p>
                  <p className="row-note">{item.note}</p>
                </div>
                <span className="row-cta">
                  打开
                  <ArrowIcon />
                </span>
              </button>
            )) : (
              <div className="empty">{activeMeta.empty}</div>
            )}
          </div>
        </section>

        <footer className="foot">
          模型与工具自动汇总 · 官方提醒为整理好的入口
        </footer>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
