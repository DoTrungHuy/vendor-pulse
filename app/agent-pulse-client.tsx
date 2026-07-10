"use client";

import { useEffect, useMemo, useState } from "react";
import type { CurrentData, EventRecord } from "./site-types";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const dataPath = (name: string) => `${basePath}/data/${name}`;

type ItemKind = "model" | "agent" | "notice";

type FeedItem = {
  id: string;
  vendor: string;
  vendorKey: string;
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
    vendorKey: "openai",
    topic: "生命周期",
    title: "模型与接口：哪些在淘汰、建议换成什么",
    note: "不只有停用日期，也有推荐替代。做迁移时先看这里。",
    time: null,
    href: "https://developers.openai.com/api/docs/deprecations",
    isPortal: true,
  },
  {
    id: "notice-openai-release-notes",
    vendor: "OpenAI",
    vendorKey: "openai",
    topic: "产品变更",
    title: "ChatGPT / 模型发布说明",
    note: "默认模型切换、功能调整、个别型号退役，常先写在这里。",
    time: null,
    href: "https://help.openai.com/en/articles/9624314-model-release-notes",
    isPortal: true,
  },
  {
    id: "notice-openai-changelog",
    vendor: "OpenAI",
    vendorKey: "openai",
    topic: "API 变更",
    title: "API 更新日志",
    note: "新能力、参数调整、开发者侧变更，比新闻稿更细。",
    time: null,
    href: "https://developers.openai.com/api/docs/changelog",
    isPortal: true,
  },
  {
    id: "notice-openai-usage",
    vendor: "OpenAI",
    vendorKey: "openai",
    topic: "使用政策",
    title: "使用政策（Usage Policies）",
    note: "能做什么、不能做什么；改版不频繁，但一改就影响合规。",
    time: null,
    href: "https://openai.com/policies/usage-policies/",
    isPortal: true,
  },
  {
    id: "notice-anthropic-lifecycle",
    vendor: "Anthropic",
    vendorKey: "anthropic",
    topic: "生命周期",
    title: "Claude 模型状态：在用 / 过渡 / 准备退役",
    note: "官方用 Active、Legacy、Deprecated 描述状态，并给替换建议。",
    time: null,
    href: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
    isPortal: true,
  },
  {
    id: "notice-anthropic-platform",
    vendor: "Anthropic",
    vendorKey: "anthropic",
    topic: "平台更新",
    title: "Claude 平台更新说明",
    note: "API、控制台、SDK 和模型迁移通知，经常混在同一页。",
    time: null,
    href: "https://platform.claude.com/docs/en/release-notes/overview",
    isPortal: true,
  },
  {
    id: "notice-google-deprecations",
    vendor: "Google",
    vendorKey: "google",
    topic: "生命周期",
    title: "Gemini 弃用时间表",
    note: "预览版、图像/视频模型何时停，官方集中列在这。",
    time: null,
    href: "https://ai.google.dev/gemini-api/docs/deprecations",
    isPortal: true,
  },
  {
    id: "notice-google-changelog",
    vendor: "Google",
    vendorKey: "google",
    topic: "API 变更",
    title: "Gemini API 更新日志",
    note: "上新、能力调整和弃用公告，很多会先出现在 changelog。",
    time: null,
    href: "https://ai.google.dev/gemini-api/docs/changelog",
    isPortal: true,
  },
  {
    id: "notice-google-models",
    vendor: "Google",
    vendorKey: "google",
    topic: "模型目录",
    title: "当前可用模型一览",
    note: "看现在能调哪些模型、预览版限制，比零散新闻清楚。",
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
  if (text.includes("openai") || text.includes("gpt") || text.includes("codex")) return { label: "OpenAI", key: "openai" };
  if (text.includes("anthropic") || text.includes("claude")) return { label: "Anthropic", key: "anthropic" };
  if (text.includes("google") || text.includes("gemini") || text.includes("agy")) return { label: "Google", key: "google" };
  if (text.includes("openclaw")) return { label: "OpenClaw", key: "other" };
  return { label: provider || name || "其他", key: "other" };
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

function writeNote(kind: ItemKind, opts: { product: string; href: string; version?: string | null; title?: string }) {
  const from = whereFrom(opts.href);
  if (kind === "agent") {
    if (opts.version) return `${opts.product} 出了新版本 ${opts.version}，详情在 ${from}`;
    return `${opts.product} 有新版本，可到 ${from} 查看`;
  }
  if (kind === "notice") {
    const title = opts.title || "";
    if (/(retir|shutdown|shut down|sunset|下线|退役)/i.test(title)) return "和停用、退役有关，点开看日期和替代";
    if (/(migrat|replacement|替代|迁移)/i.test(title)) return "和迁移、替换有关，看官方建议怎么换";
    return `相关说明在 ${from}`;
  }
  if (from === "官网新闻") return `${opts.product} 的公开模型消息，来自新闻稿`;
  if (from === "更新日志") return `${opts.product} 在更新日志里提到的模型变化`;
  return `${opts.product} 的模型动态，来自 ${from}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "点进官网查看最新";
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
  if (!value) return "尚未更新";
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (mins < 1) return "刚刚同步";
  if (mins < 60) return `${mins} 分钟前同步`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} 小时前同步`;
  return `${Math.floor(hours / 24)} 天前同步`;
}

function statusText(status: string) {
  if (status === "ok") return "数据正常";
  if (status === "stale") return "部分源延迟";
  if (status === "error") return "部分源异常";
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
    vendorKey: vendor.key,
    title: displayTitle(event.title),
    note: writeNote(kind, { product, href: event.source_url, title: event.title }),
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
        vendorKey: vendor.key,
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
        vendorKey: vendor.key,
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
    ? {
        kicker: "官方模型动态",
        title: "新模型",
        tone: "tone-model",
        empty: "暂时没有解析到新模型，稍后再采集。",
        hint: null as string | null,
      }
    : tab === "agents"
      ? {
          kicker: "编程助手与工具",
          title: "Agent 工具",
          tone: "tone-agent",
          empty: "暂时没有工具发版记录。",
          hint: null,
        }
      : {
          kicker: "生命周期 · 迁移 · API · 政策",
          title: "官方提醒",
          tone: "tone-policy",
          empty: "暂无入口。",
          hint: "这一栏不是自动摘要。下面每条都是各厂长期维护的说明页：模型状态、迁移替换、API 变更、使用政策都在里面——不只有下线。",
        };

  const handleOpen = (item: FeedItem) => {
    if (!isHttpUrl(item.href)) {
      setToast("这条没有可用链接");
      return;
    }
    openOfficialLink(item.href);
  };

  if (!ready) {
    return (
      <div className="desk">
        <div className="desk-bg" />
        <div className="loading">正在加载更新清单…</div>
      </div>
    );
  }

  return (
    <div className="desk">
      <div className="desk-bg" />
      <div className="desk-noise" />

      <div className="desk-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <div>
              <div className="brand-text">脉搏速递</div>
              <div className="brand-sub">新模型 · 工具 · 官方提醒</div>
            </div>
          </div>
          <div className="top-meta">
            <div className="pill glass">
              <span className={`dot ${current.status === "ok" ? "" : current.status === "error" ? "bad" : "warn"}`} />
              {statusText(current.status)}
            </div>
            <div className="pill glass">{relativeTime(current.generated_at)}</div>
          </div>
        </header>

        <section className="hero glass">
          <div className="hero-kicker glass">
            <strong>免费</strong>
            点任意一条，直接打开官网原文
          </div>
          <h1>先知道变化，再决定要不要跟</h1>
          <div className="hero-nav">
            <button type="button" className={`nav-chip ${tab === "models" ? "solid" : "glass"}`} onClick={() => setTab("models")}>
              新模型（{models.length}）
            </button>
            <button type="button" className={`nav-chip ${tab === "agents" ? "solid" : "glass"}`} onClick={() => setTab("agents")}>
              Agent 工具（{agents.length}）
            </button>
            <button type="button" className={`nav-chip ${tab === "notices" ? "solid" : "glass"}`} onClick={() => setTab("notices")}>
              官方提醒（{notices.length}）
            </button>
          </div>
        </section>

        <div className="board">
          <section className="section glass" aria-live="polite">
            <div className="section-head">
              <div>
                <p className="section-label">{activeMeta.kicker}</p>
                <h2 className="section-title">{activeMeta.title}</h2>
              </div>
              <div className="section-count">
                {tab === "notices" ? `${notices.length} 个官网入口` : `${activeItems.length} 条`}
              </div>
            </div>

            {activeMeta.hint ? <p className="panel-hint">{activeMeta.hint}</p> : null}

            <div className="feed">
              {activeItems.length ? activeItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`item ${activeMeta.tone}`}
                  onClick={() => handleOpen(item)}
                  title={item.href}
                >
                  <div className="card-left">
                    <span className={`vendor ${item.vendorKey}`}>{item.vendor}</span>
                    {item.topic ? <span className="topic-pill">{item.topic}</span> : null}
                  </div>
                  <div className="item-main">
                    <p className="item-title">{item.title}</p>
                    <p className="item-sub">{item.note}</p>
                    <p className="item-time">{item.isPortal ? "点进官网查看最新" : formatDate(item.time)}</p>
                  </div>
                  <div className="item-side">
                    <span className="item-go">{item.isPortal ? "去官网" : "打开原文"}</span>
                  </div>
                </button>
              )) : (
                <div className="empty">{activeMeta.empty}</div>
              )}
            </div>
          </section>
        </div>

        <footer className="footer">
          新模型、工具发版会自动汇总；官方提醒是整理好的官网入口，避免乱摘要。
          <br />
          若内置预览打不开外链，请用系统浏览器访问本页后再点。
        </footer>
      </div>

      {toast ? <div className="toast glass">{toast}</div> : null}
    </div>
  );
}
