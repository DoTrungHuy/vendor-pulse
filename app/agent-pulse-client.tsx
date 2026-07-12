"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CurrentData, EventRecord, SnapshotBundle } from "./site-types";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const dataPath = (name: string) => `${basePath}/data/${name}`;
const assetPath = (path: string) => `${basePath}${path}`;
const remoteDataPath = (name: string) => `https://raw.githubusercontent.com/DoTrungHuy/vendor-pulse/main/public/data/${name}`;

type SnapshotSource = "github" | "local";

async function fetchSnapshot<T>(url: string, name: string, version: number, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${url}?v=${version}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`${name} unavailable (${response.status})`);
  return response.json() as Promise<T>;
}

function validateBundle(bundle: SnapshotBundle) {
  if (!bundle || bundle.schema_version !== 1 || !bundle.snapshot_id) throw new Error("snapshot bundle is invalid");
  if (!bundle.current || !Array.isArray(bundle.events)) throw new Error("snapshot bundle is incomplete");
  if (bundle.current.snapshot_id !== bundle.snapshot_id || bundle.health?.snapshot_id !== bundle.snapshot_id) {
    throw new Error("snapshot bundle versions do not match");
  }
  return bundle;
}

async function fetchSnapshotBundle(version: number, preferRemote = true, signal: AbortSignal) {
  const candidates: Array<{ source: SnapshotSource; path: (name: string) => string }> = preferRemote
    ? [{ source: "github", path: remoteDataPath }, { source: "local", path: dataPath }]
    : [{ source: "local", path: dataPath }];
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    const candidateSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(candidate.source === "github" ? 6_000 : 2_000),
    ]);
    try {
      const bundle = validateBundle(await fetchSnapshot<SnapshotBundle>(candidate.path("bundle.json"), "bundle.json", version, candidateSignal));
      return { current: bundle.current, events: bundle.events, source: candidate.source };
    } catch (bundleError) {
      if (signal.aborted) throw bundleError;
    }
    try {
      const [current, events] = await Promise.all([
        fetchSnapshot<CurrentData>(candidate.path("current.json"), "current.json", version, candidateSignal),
        fetchSnapshot<EventRecord[]>(candidate.path("events.json"), "events.json", version, candidateSignal),
      ]);
      return { current, events, source: candidate.source };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error("snapshot bundle unavailable");
}

const HERO_VIDEO = assetPath("/videos/hero-desktop.mp4");
const HERO_VIDEO_MOBILE = assetPath("/videos/hero-mobile.mp4");
const HERO_POSTER = assetPath("/media/hero-poster.webp");
const SIGNALS_VIDEO = assetPath("/videos/signals-desktop.mp4");
const SIGNALS_VIDEO_MOBILE = assetPath("/videos/signals-mobile.mp4");
const SIGNALS_POSTER = assetPath("/media/signals-poster.webp");
const PROJECT_REPOSITORY = "https://github.com/DoTrungHuy/vendor-pulse";
const CONTACT_EMAIL = "tdo770756@gmail.com";

type ItemKind = "model" | "agent" | "notice";
type TabId = "models" | "agents" | "notices";
type Confidence = "verified" | "needs_review";
type MobileView = "home" | "today" | TabId;

const MOBILE_BREAKPOINT = "(max-width: 640px)";
const MOBILE_VIEWS = new Set<MobileView>(["home", "today", "models", "agents", "notices"]);

function mobileViewFromHash(): MobileView {
  if (typeof window === "undefined") return "home";
  const candidate = window.location.hash.replace(/^#/, "") as MobileView;
  return MOBILE_VIEWS.has(candidate) ? candidate : "home";
}

function isMobileCategory(view: MobileView): view is TabId {
  return view === "models" || view === "agents" || view === "notices";
}

type FeedItem = {
  id: string;
  vendor: string;
  title: string;
  note: string;
  time: string | null;
  href: string;
  confidence: Confidence;
  kind: ItemKind;
  publishedAt?: string | null;
  effectiveAt?: string | null;
  isPortal?: boolean;
  topic?: string;
};

type SnapshotHighlight = {
  label: string;
  item: FeedItem;
  reason: string;
  signal: string;
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
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
    confidence: "verified",
    kind: "notice",
    isPortal: true,
  },
];

const emptyCurrent: CurrentData = {
  generated_at: null,
  checked_at: null,
  content_updated_at: null,
  last_full_success_at: null,
  timezone: "Asia/Shanghai",
  status: "bootstrapping",
  tools: [],
  models: [],
};

function cleanTitle(raw: string) {
  return raw
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/^[^:]{1,40}:\s*(?=\S)/, "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF]/g, "")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeRepeatedProduct(raw: string, product: string) {
  const title = cleanTitle(raw);
  const escaped = escapeRegExp(product);
  return title.replace(new RegExp(`^${escaped}\\s+${escaped}\\b`, "i"), product);
}

function releaseTitle(product: string, raw: string) {
  const title = removeRepeatedProduct(raw, product);
  return new RegExp(`^${escapeRegExp(product)}\\b`, "i").test(title) ? title : `${product} ${title}`;
}

function displayTitle(raw: string, max = 100) {
  const title = cleanTitle(raw);
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const pause = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "), cut.lastIndexOf("！"), cut.lastIndexOf(", "));
  return `${(pause > 36 ? cut.slice(0, pause) : cut).trim()}…`;
}

function policyDisplayTitle(raw: string) {
  let title = cleanTitle(raw);
  for (const marker of ["GPT-5 and o3 model deprecations", "Reusable prompts"]) {
    const index = title.indexOf(marker);
    if (index > 0) title = title.slice(index);
  }
  return displayTitle(title);
}

function isConcreteNotice(title: string) {
  const text = cleanTitle(title);
  if (text.length < 28 || text.length > 260) return false;
  const noise = [
    /see which .* are active/i,
    /this page lists/i,
    /current and recently retired models are listed/i,
    /api model name current state deprecated/i,
    /\bactive n\/a not sooner than\b/i,
    /shutdown date model \/ system recommended replacement/i,
    /upcoming deprecations(?:\s+upcoming deprecations|\s+are listed)/i,
    /all deprecations are listed below/i,
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

function formatCalendarDate(value: string | null | undefined) {
  if (!value) return "日期待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function dateFromTitle(value: string) {
  const text = cleanTitle(value);
  const datePattern = "((?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+20\\d{2}|20\\d{2}-\\d{2}-\\d{2})";
  const actionDate = new RegExp(`(?:shut\\s*down|retir(?:ed|ement)|remov(?:ed|al)|sunset|end of (?:life|support))[^.]{0,40}?(?:on\\s+)?${datePattern}`, "i").exec(text)?.[1];
  if (actionDate) {
    const actionTime = new Date(`${actionDate} UTC`);
    if (Number.isFinite(actionTime.getTime())) return actionTime.toISOString();
  }
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return new Date(`${iso}T00:00:00.000Z`).toISOString();
  const long = text.match(/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})\b/i)?.[1];
  if (!long) return null;
  const date = new Date(`${long} UTC`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function lifecycleHeadline(item: FeedItem, upcoming: boolean) {
  const title = cleanTitle(item.title);
  const fastMode = title.match(/fast mode for ([^,]+),\s*with removal/i)?.[1];
  if (fastMode) return `${fastMode} 的 Fast Mode ${upcoming ? "即将停止" : "已经停止"}`;
  const retiring = title.match(/(.+?)\s+will be retired on/i)?.[1];
  if (retiring) return `${cleanTitle(retiring)} ${upcoming ? "即将停止服务" : "已经停止服务"}`;
  const retired = title.match(/we(?:'|’)ve retired the (.+?) model/i)?.[1];
  if (retired) return `${cleanTitle(retired)} 已经停止服务`;
  return displayTitle(title, 74);
}

function relativeTime(value: string | null, now = Date.now()) {
  if (!value) return "尚未生成";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "时间待确认";
  const mins = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function compactMetric(value: number | null | undefined) {
  if (!value) return "暂无数据";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function snapshotStatus(current: CurrentData, now: number, source: SnapshotSource) {
  const checkedAt = current.checked_at || current.generated_at;
  if (!checkedAt) return { label: "等待快照", detail: "等待首次自动采集" };
  const generatedTimestamp = new Date(checkedAt).getTime();
  if (!Number.isFinite(generatedTimestamp)) return { label: "时间异常", detail: "快照时间无法识别，请重新同步" };
  const minutes = Math.max(0, Math.floor((now - generatedTimestamp) / 60_000));
  const contentAge = relativeTime(current.content_updated_at || current.generated_at, now);
  if (source === "local") return { label: "最近有效快照", detail: `内容${contentAge}更新` };

  if (minutes >= 90 || current.status === "error") return { label: "自动更新稍有延迟", detail: "当前展示最近一次核验内容" };
  if ((current.status === "degraded" || current.status === "stale") && (current.source_counts?.required_failed || 0) > 0) {
    return { label: "部分信息更新延迟", detail: "当前展示最近一次核验内容" };
  }
  return { label: "官方信息已同步", detail: `内容${contentAge}更新` };
}

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function dedupeItems(items: FeedItem[]) {
  const unique = new Map<string, FeedItem>();
  for (const item of items) {
    const clean = cleanTitle(item.title).replace(/^model status\s+/i, "");
    const lifecycleSubject = item.kind === "notice"
      ? clean.match(/(.+?)\s+will be retired on/i)?.[1]
        || clean.match(/fast mode for ([^,]+),\s*with removal/i)?.[1]
        || clean.match(/we(?:'|’)ve retired the (.+?) model/i)?.[1]
        || clean
      : clean;
    const key = `${item.kind}|${item.vendor}|${lifecycleSubject}|${item.effectiveAt?.slice(0, 10) || ""}`.toLowerCase();
    const previous = unique.get(key);
    if (!previous || (previous.confidence === "needs_review" && item.confidence === "verified")) unique.set(key, item);
  }
  return [...unique.values()];
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
  const confidence: Confidence = event.confidence === "verified" ? "verified" : "needs_review";
  const effectiveAt = event.effective_at || (kind === "notice" ? dateFromTitle(event.title) : null);
  return {
    id: event.id,
    vendor: vendor.label,
    title: kind === "notice" ? policyDisplayTitle(removeRepeatedProduct(event.title, product)) : displayTitle(removeRepeatedProduct(event.title, product)),
    note: confidence === "verified"
      ? writeNote(kind, { product, href: event.source_url })
      : "页面变化已被捕获，但尚未确认是正式发布；请以官方原文为准。",
    time: event.published_at || event.occurred_at,
    href: event.source_url,
    confidence,
    kind,
    publishedAt: event.published_at || (kind === "notice" ? null : event.occurred_at),
    effectiveAt,
  };
}

function openOfficialLink(url: string) {
  if (!isHttpUrl(url)) return false;
  try {
    const opened = window.open(url, "_blank");
    if (!opened) return false;
    opened.opener = null;
    return true;
  } catch {
    return false;
  }
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

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.22-3.37-1.22-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.66.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.93c.85 0 1.69.12 2.5.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.71 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.89v2.81c0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4.5 7 7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CornerLinks() {
  return (
    <div className="corner-links">
      <div className="corner-link-item">
        <a className="brand-orb liquid-glass" href={PROJECT_REPOSITORY} target="_blank" rel="noreferrer" aria-label="查看项目源码">
          <GitHubIcon />
        </a>
        <span className="corner-link-label liquid-glass" aria-hidden="true">项目源码</span>
      </div>
      <div className="corner-link-item contact-link-item">
        <a className="brand-orb liquid-glass" href={`mailto:${CONTACT_EMAIL}`} aria-label={`联系作者：${CONTACT_EMAIL}`}>
          <MailIcon />
        </a>
        <span className="corner-link-label liquid-glass" aria-hidden="true">联系作者</span>
      </div>
    </div>
  );
}

type FadingVideoProps = {
  src: string;
  mobileSrc?: string;
  poster: string;
  className?: string;
  loadStrategy?: "eager" | "visible";
};

function FadingVideo({ src, mobileSrc, poster, className, loadStrategy = "eager" }: FadingVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);
  const [shouldLoad, setShouldLoad] = useState(loadStrategy === "eager");

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

    if (loadStrategy === "eager") return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { threshold: 0.01 });

    observer.observe(video);
    return () => observer.disconnect();
  }, [loadStrategy]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldLoad) return;
    let restartTimer: number | undefined;

    const start = async () => {
      fadingOutRef.current = false;
      video.style.opacity = "0";
      try {
        await video.play();
        fadeTo(1);
      } catch {
        video.style.opacity = "0";
      }
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
        void start();
      }, 100);
    };
    const showPoster = () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      video.style.opacity = "0";
    };

    video.addEventListener("loadeddata", start);
    video.addEventListener("timeupdate", fadeBeforeEnd);
    video.addEventListener("ended", restart);
    video.addEventListener("error", showPoster);
    video.load();
    if (video.readyState >= 2) void start();

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (restartTimer !== undefined) window.clearTimeout(restartTimer);
      video.removeEventListener("loadeddata", start);
      video.removeEventListener("timeupdate", fadeBeforeEnd);
      video.removeEventListener("ended", restart);
      video.removeEventListener("error", showPoster);
    };
  }, [fadeTo, shouldLoad]);

  return (
    <>
      {/* A plain image keeps the exact video crop and provides a zero-JS first-frame fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={`${className || ""} stage-poster`}
        src={poster}
        alt=""
        aria-hidden="true"
        loading={loadStrategy === "eager" ? "eager" : "lazy"}
        fetchPriority={loadStrategy === "eager" ? "high" : "low"}
      />
      <video
        ref={videoRef}
        className={`${className || ""} stage-motion`}
        poster={poster}
        autoPlay
        muted
        playsInline
        preload={loadStrategy === "eager" ? "auto" : "none"}
      >
        {shouldLoad && mobileSrc ? <source src={mobileSrc} media={MOBILE_BREAKPOINT} type="video/mp4" /> : null}
        {shouldLoad ? <source src={src} type="video/mp4" /> : null}
      </video>
    </>
  );
}

export function AgentPulseClient() {
  const [current, setCurrent] = useState<CurrentData>(emptyCurrent);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>(() => {
    const initialView = mobileViewFromHash();
    return isMobileCategory(initialView) ? initialView : "models";
  });
  const [toast, setToast] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [snapshotSource, setSnapshotSource] = useState<SnapshotSource>("local");
  const [isMobileLayout, setIsMobileLayout] = useState(() => typeof window !== "undefined" && window.matchMedia(MOBILE_BREAKPOINT).matches);
  const [mobileView, setMobileView] = useState<MobileView>(() => mobileViewFromHash());
  const signalSectionRef = useRef<HTMLElement>(null);
  const snapshotIdRef = useRef<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const mobileFlowRef = useRef<HTMLDivElement>(null);
  const mobileHomeRef = useRef<HTMLElement>(null);
  const mobileTodayRef = useRef<HTMLElement>(null);

  const navigateMobile = useCallback((nextView: MobileView, replace = false) => {
    const currentlyFromToday = window.history.state?.mobileFrom === "today" || mobileView === "today";
    const nextState = {
      mobileView: nextView,
      mobileFrom: isMobileCategory(nextView) && currentlyFromToday ? "today" : undefined,
    };
    window.history[replace ? "replaceState" : "pushState"](nextState, "", `#${nextView}`);
    if (isMobileCategory(nextView)) {
      setTab(nextView);
    }
    setMobileView(nextView);
  }, [mobileView]);

  const returnToMobileToday = useCallback(() => {
    if (window.history.state?.mobileFrom === "today") {
      window.history.back();
      return;
    }
    navigateMobile("today", true);
  }, [navigateMobile]);

  const loadData = useCallback(async (manual = false, preferRemote = true) => {
    const startedAt = Date.now();
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    if (manual) {
      setIsRefreshing(true);
      setToast("正在读取 GitHub 最新公开快照…");
    }
    try {
      const version = Date.now();
      const { current: nextCurrent, events: nextEvents, source } = await fetchSnapshotBundle(version, preferRemote, controller.signal);
      if (sequence !== requestSequenceRef.current) return;
      if (!nextCurrent || !Array.isArray(nextCurrent.tools) || !Array.isArray(nextCurrent.models)) throw new Error("current data is invalid");
      if (!Array.isArray(nextEvents)) throw new Error("events data is invalid");

      const previousSnapshotId = snapshotIdRef.current;
      setCurrent(nextCurrent);
      setEvents(nextEvents);
      setSnapshotSource(source);
      snapshotIdRef.current = nextCurrent.snapshot_id || nextCurrent.generated_at;
      if (manual) {
        setToast(source === "github"
          ? previousSnapshotId && previousSnapshotId === snapshotIdRef.current
            ? "当前已是 GitHub main 最新公开快照"
            : "已读取 GitHub main 更新后的公开快照"
          : "GitHub 暂时不可用，已整体回退本地快照");
      }
    } catch (error) {
      if (manual && sequence === requestSequenceRef.current) {
        setToast(error instanceof DOMException && error.name === "AbortError"
          ? "读取快照超时，已保留当前数据"
          : "无法读取最新快照，已保留当前数据");
      }
    } finally {
      window.clearTimeout(timeout);
      if (manual && sequence === requestSequenceRef.current) {
        const remaining = 550 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      if (sequence === requestSequenceRef.current) {
        setReady(true);
        setIsRefreshing(false);
        requestControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadData]);

  useEffect(() => {
    const syncTimer = window.setInterval(() => void loadData(false, true), 10 * 60_000);
    return () => window.clearInterval(syncTimer);
  }, [loadData]);

  useEffect(() => {
    const syncWhenActive = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void loadData(false, true);
    };
    window.addEventListener("focus", syncWhenActive);
    window.addEventListener("online", syncWhenActive);
    document.addEventListener("visibilitychange", syncWhenActive);
    return () => {
      window.removeEventListener("focus", syncWhenActive);
      window.removeEventListener("online", syncWhenActive);
      document.removeEventListener("visibilitychange", syncWhenActive);
    };
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_BREAKPOINT);
    const syncLayout = () => setIsMobileLayout(media.matches);
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) return;
    const syncView = () => {
      const nextView = mobileViewFromHash();
      if (isMobileCategory(nextView)) {
        setTab(nextView);
      }
      setMobileView(nextView);
    };
    syncView();
    window.addEventListener("popstate", syncView);
    window.addEventListener("hashchange", syncView);
    return () => {
      window.removeEventListener("popstate", syncView);
      window.removeEventListener("hashchange", syncView);
    };
  }, [isMobileLayout]);

  useEffect(() => {
    if (!ready || !isMobileLayout || isMobileCategory(mobileView)) return;
    const target = mobileView === "today" ? mobileTodayRef.current : mobileHomeRef.current;
    if (!target) return;
    window.requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: "auto" }));
  }, [isMobileLayout, mobileView, ready]);

  useEffect(() => {
    if (!ready || !isMobileLayout || isMobileCategory(mobileView)) return;
    const root = mobileFlowRef.current;
    const home = mobileHomeRef.current;
    const today = mobileTodayRef.current;
    if (!root || !home || !today) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible || visible.intersectionRatio < 0.55) return;
      const nextView: MobileView = visible.target === today ? "today" : "home";
      setMobileView((currentView) => {
        if (currentView === nextView) return currentView;
        window.history.replaceState({ mobileView: nextView }, "", `#${nextView}`);
        return nextView;
      });
    }, { root, threshold: [0.55, 0.75] });

    observer.observe(home);
    observer.observe(today);
    return () => observer.disconnect();
  }, [isMobileLayout, mobileView, ready]);

  const models = useMemo(() => {
    const fromEvents = events.filter((event) => event.type === "model").map(eventToItem).filter(Boolean) as FeedItem[];
    const fromCurrent = (current.models || []).flatMap((model) => {
      const signal = model.latest_model;
      const href = signal?.source_url || model.source_url;
      if (!signal?.title || !isHttpUrl(href)) return [];
      const vendor = vendorOf(model.name, model.provider);
      const confidence: Confidence = signal.confidence === "verified" ? "verified" : "needs_review";
      return [{
        id: `current-model-${model.id}`,
        vendor: vendor.label,
        title: displayTitle(removeRepeatedProduct(signal.title, model.name)),
        note: confidence === "verified"
          ? writeNote("model", { product: model.name, href })
          : "页面变化已被捕获，但尚未确认是正式模型发布。",
        time: signal.published_at || signal.occurred_at || model.occurred_at,
        href,
        confidence,
        kind: "model",
        publishedAt: signal.published_at || signal.occurred_at || model.occurred_at,
        effectiveAt: signal.effective_at || null,
      } satisfies FeedItem];
    });
    return sortByTime(dedupeItems([...fromEvents, ...fromCurrent]));
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
        title: releaseTitle(tool.name, version),
        note: writeNote("agent", { product: tool.name, href: tool.latest_release.url, version: tool.latest_release.tag }),
        time: tool.latest_release.published_at,
        href: tool.latest_release.url,
        confidence: "verified",
        kind: "agent",
        publishedAt: tool.latest_release.published_at,
        effectiveAt: null,
      } satisfies FeedItem];
    });
    return sortByTime(dedupeItems([...fromEvents, ...fromTools]));
  }, [events, current.tools]);

  const policies = useMemo(() => {
    const items = events.filter((event) => event.type === "deprecation").map(eventToItem).filter(Boolean) as FeedItem[];
    return sortByTime(dedupeItems(items));
  }, [events]);

  const verifiedModels = models.filter((item) => item.confidence === "verified");
  const verifiedAgents = agents.filter((item) => item.confidence === "verified");
  const verifiedPolicies = policies.filter((item) => item.confidence === "verified");
  const activeVerifiedItems = tab === "models" ? verifiedModels : tab === "agents" ? verifiedAgents : verifiedPolicies;
  const activeItems = activeVerifiedItems.slice(0, 16);
  const totalSignals = verifiedModels.length + verifiedAgents.length + verifiedPolicies.length;
  const providers = new Set([...models, ...agents, ...policies, ...OFFICIAL_NOTICES].map((item) => item.vendor)).size;
  const snapshotHighlights = useMemo(() => {
    const highlights: SnapshotHighlight[] = [];
    const usedLinks = new Set<string>();
    const snapshotTimeValue = current.checked_at || current.generated_at;
    const snapshotTime = snapshotTimeValue ? new Date(snapshotTimeValue).getTime() : clockTick;
    const day = 24 * 60 * 60 * 1000;
    const verifiedNewsItems = [...models, ...agents]
      .filter((item) => item.confidence === "verified")
      .filter((item) => item.time && new Date(item.time).getTime() <= snapshotTime);
    const recentReleaseItems = sortByTime(dedupeItems(verifiedNewsItems))
      .filter((item) => item.time && clockTick - new Date(item.time).getTime() <= 7 * day);
    const latestItem = recentReleaseItems[0];

    if (latestItem) {
      const previewRelease = /(?:alpha|beta|preview|rc)[.-]?\d*/i.test(latestItem.title);
      const releaseAge = clockTick - new Date(latestItem.time as string).getTime();
      highlights.push({
        label: releaseAge <= day ? "刚刚发布" : "近期发布",
        item: latestItem,
        signal: `${relativeTime(latestItem.time, clockTick)}发布`,
        reason: previewRelease
          ? `${latestItem.vendor} 发布了新的测试版本。建议先查看变更日志并完成验证，再决定是否用于正式工作流。`
          : `${latestItem.vendor} 发布了当前时间最近的正式更新。建议先确认能力变化与现有工作流是否相关。`,
      });
      usedLinks.add(latestItem.href);
    }

    const heatCandidates = [...(current.tools || [])]
      .filter((tool) => tool.latest_release && isHttpUrl(tool.latest_release.url))
      .map((tool) => ({
        tool,
        stars: Math.max(0, tool.stars_delta_24h || 0),
        downloads: Math.log10((tool.npm?.weekly_downloads || 0) + 1),
      }));
    const maxStars = Math.max(1, ...heatCandidates.map((candidate) => candidate.stars));
    const maxDownloads = Math.max(1, ...heatCandidates.map((candidate) => candidate.downloads));
    const hottestTool = heatCandidates
      .map((candidate) => ({
        ...candidate.tool,
        heatScore: (candidate.stars / maxStars) * 0.65 + (candidate.downloads / maxDownloads) * 0.35,
      }))
      .sort((a, b) => b.heatScore - a.heatScore)[0];
    const hottestItem = hottestTool
      ? agents.find((item) => item.href === hottestTool.latest_release?.url)
      : undefined;

    if (hottestTool && hottestItem && !usedLinks.has(hottestItem.href)) {
      const starDelta = hottestTool.stars_delta_24h || 0;
      highlights.push({
        label: "正在升温",
        item: hottestItem,
        signal: starDelta > 0 ? `+${starDelta} Star / 24h` : `${compactMetric(hottestTool.npm?.weekly_downloads)} 周下载`,
        reason: `${hottestTool.name} 近 24 小时新增 ${starDelta} Star，npm 周下载约 ${compactMetric(hottestTool.npm?.weekly_downloads)}，综合热度在当前监测工具中最高。`,
      });
      usedLinks.add(hottestItem.href);
    }

    const lifecycleItems = policies
      .filter((item) => item.confidence === "verified" && item.effectiveAt && !usedLinks.has(item.href))
      .map((item) => ({ item, effectiveTime: new Date(item.effectiveAt as string).getTime() }));
    const upcomingRisk = lifecycleItems
      .filter(({ effectiveTime }) => effectiveTime > clockTick && effectiveTime - clockTick <= 90 * day)
      .sort((a, b) => a.effectiveTime - b.effectiveTime)[0];
    const recentRisk = lifecycleItems
      .filter(({ effectiveTime }) => effectiveTime <= clockTick && clockTick - effectiveTime <= 30 * day)
      .sort((a, b) => b.effectiveTime - a.effectiveTime)[0];
    const selectedRisk = upcomingRisk || recentRisk;

    if (selectedRisk) {
      const upcoming = selectedRisk.effectiveTime > clockTick;
      const riskItem = {
        ...selectedRisk.item,
        title: lifecycleHeadline(selectedRisk.item, upcoming),
      };
      highlights.push({
        label: upcoming ? "需要行动" : "已经生效",
        item: riskItem,
        signal: `${formatCalendarDate(riskItem.effectiveAt)}`,
        reason: upcoming
          ? `${riskItem.vendor} 已确认该变化即将生效。仍在使用相关能力的项目应尽快核对替代方案并安排迁移测试。`
          : `${riskItem.vendor} 的停止日期已经过去。仍在使用相关模型或接口的项目应立即确认替代方案。`,
      });
      usedLinks.add(riskItem.href);
    }

    if (highlights.length < 3) {
      const fallback = recentReleaseItems.find((item) => !usedLinks.has(item.href));
      if (fallback) {
        highlights.push({
          label: "重要更新",
          item: fallback,
          signal: `${relativeTime(fallback.time, clockTick)}发布`,
          reason: `${fallback.vendor} 的这项更新已经过来源核验，适合结合当前项目需求判断是否需要进一步测试。`,
        });
      }
    }

    return highlights.slice(0, 3);
  }, [agents, clockTick, current.checked_at, current.generated_at, current.tools, models, policies]);
  const activeMeta = tab === "models"
    ? { title: "模型发布", label: "模型更新", copy: "汇总厂商官网与发布说明中的新模型和能力变化，每条均可回到官方原文核验。", icon: <ImageIcon />, tags: ["最新发布", "官方来源", "模型更新"] }
    : tab === "agents"
      ? { title: "Agent 工具", label: "工具更新", copy: "跟踪 Agent 工具的正式版本与开源发布，快速确认工作流中值得升级的变化。", icon: <MovieIcon />, tags: ["版本发布", "GitHub", "工具链"] }
      : { title: "弃用与迁移", label: "风险提醒", copy: "集中查看模型停用、接口弃用与迁移说明，为替换和调整提前留出时间。", icon: <LightIcon />, tags: ["弃用迁移", "官方文档", "政策提醒"] };
  const snapshotMeta = snapshotStatus(current, clockTick, snapshotSource);
  const activeTotal = activeVerifiedItems.length;
  const activeCountLabel = `${activeItems.length < activeTotal ? `最近 ${activeItems.length} 条 · 共 ` : ""}${activeTotal} 条官方已核验更新`;
  const activeIntro = activeMeta.copy;

  const handleOpen = (item: FeedItem) => {
    if (!isHttpUrl(item.href)) {
      setToast("这条没有可用链接");
      return;
    }
    if (!openOfficialLink(item.href)) {
      setToast("浏览器阻止了新标签页，请允许弹窗后重试");
    }
  };

  const selectFeed = (nextTab: TabId, shouldScroll = false) => {
    setTab(nextTab);
    if (shouldScroll) signalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToSignals = () => signalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const feedCards: Array<{ id: TabId; title: string; count: number; icon: React.ReactNode; tags: string[]; copy: string }> = [
    { id: "models", title: "模型发布", count: verifiedModels.length, icon: <ImageIcon />, tags: [`已核验 ${verifiedModels.length}`, "明确日期", "官方原文"], copy: "只展示带有明确发布日期、并可直达官方原文的模型与能力变化。" },
    { id: "agents", title: "Agent 工具", count: verifiedAgents.length, icon: <MovieIcon />, tags: [`已核验 ${verifiedAgents.length}`, "GitHub", "npm"], copy: "跟踪 Codex、Claude Code 等工具的正式版本与热度变化。" },
    { id: "notices", title: "弃用与迁移", count: verifiedPolicies.length, icon: <LightIcon />, tags: [`已核验 ${verifiedPolicies.length}`, "明确日期", `官方入口 ${OFFICIAL_NOTICES.length}`], copy: "只呈现有明确对象、日期和官方迁移依据的停用事件。" },
  ];

  if (isMobileLayout && !isMobileCategory(mobileView)) {
    return (
      <div className="mobile-experience">
        <div ref={mobileFlowRef} className="mobile-home-flow">
          <FadingVideo className="stage-video mobile-flow-video" src={HERO_VIDEO} mobileSrc={HERO_VIDEO_MOBILE} poster={HERO_POSTER} />

          <section ref={mobileHomeRef} className="mobile-landing-panel" aria-label="Agent Pulse 手机端首页">
            <header className="mobile-landing-nav">
              <CornerLinks />
              <button type="button" className="mobile-sync-button liquid-glass-strong" onClick={() => void loadData(true)} disabled={isRefreshing}>
                {isRefreshing ? "读取中" : "读取快照"}<ArrowIcon />
              </button>
            </header>

            <div className="mobile-landing-content">
              <div className="mobile-live-badge liquid-glass">
                <span>{snapshotMeta.label}</span>
                <p>{snapshotMeta.detail}</p>
              </div>
              <h1>见微知著</h1>
              <p>把分散的模型发布、Agent 工具更新与弃用提醒，整理成可以快速判断、随时核验的官方信号。</p>
            </div>

            <div className="mobile-swipe-cue" aria-hidden="true">
              <span>向上滑动</span>
              <b>查看今日重点</b>
              <i>↑</i>
            </div>
          </section>

          <section ref={mobileTodayRef} className="mobile-today-panel" aria-labelledby="mobile-today-title">
            <header className="mobile-today-header">
              <div>
                <p>{"// TODAY'S PULSE"}</p>
                <h2 id="mobile-today-title">今日重点</h2>
              </div>
              <button type="button" className="mobile-sync-button liquid-glass-strong" onClick={() => void loadData(true)} disabled={isRefreshing}>
                {isRefreshing ? "读取中" : "读取"}<ArrowIcon />
              </button>
            </header>
            <p className="mobile-today-status">{snapshotMeta.label} · {snapshotMeta.detail}</p>

            <div className="mobile-highlight-stack">
              {snapshotHighlights.map(({ label, item, reason, signal }, index) => (
                <button key={`${label}-${item.id}`} type="button" className="mobile-highlight-card liquid-glass frosted-panel" onClick={() => handleOpen(item)}>
                  <span className="mobile-highlight-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="mobile-highlight-meta"><span>{label}</span><b>{item.vendor}</b><em>{signal}</em></p>
                    <h3>{item.title}</h3>
                    <p className="mobile-highlight-note">{reason}</p>
                    <span className="mobile-card-link">查看官方原文 <ArrowIcon /></span>
                  </div>
                </button>
              ))}
            </div>

            <div className="mobile-category-section">
              <div className="mobile-section-heading">
                <p>{"// BROWSE BY SIGNAL"}</p>
                <h2>选择关注方向</h2>
              </div>
              <div className="mobile-category-entries">
                {feedCards.map((card) => (
                  <button key={card.id} type="button" className="mobile-category-entry liquid-glass frosted-panel" onClick={() => navigateMobile(card.id)}>
                    <span className="feed-icon liquid-glass">{card.icon}</span>
                    <div><h3>{card.title}</h3><p>{card.copy}</p></div>
                    <strong>{String(card.count).padStart(2, "0")}</strong>
                    <ArrowIcon />
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
        {toast ? <div className="toast liquid-glass" role="status">{toast}</div> : null}
      </div>
    );
  }

  if (isMobileLayout && isMobileCategory(mobileView)) {
    return (
      <div className="mobile-category-view">
        <FadingVideo className="stage-video mobile-category-video" src={SIGNALS_VIDEO} mobileSrc={SIGNALS_VIDEO_MOBILE} poster={SIGNALS_POSTER} />
        <header className="mobile-category-header liquid-glass">
          <div className="mobile-category-toolbar">
            <button type="button" className="mobile-back-button" onClick={returnToMobileToday} aria-label="返回今日重点"><span aria-hidden="true">←</span></button>
            <div><p>{activeMeta.label}</p><strong>{activeMeta.title}</strong></div>
            <button type="button" className="mobile-header-sync" onClick={() => void loadData(true)} disabled={isRefreshing}>{isRefreshing ? "读取中" : "读取"}</button>
          </div>
          <nav className="mobile-category-tabs" aria-label="切换情报分类">
            {feedCards.map((card) => (
              <button key={card.id} type="button" className={tab === card.id ? "is-active" : ""} onClick={() => navigateMobile(card.id, true)} aria-pressed={tab === card.id}>
                {card.title}
              </button>
            ))}
          </nav>
        </header>

        <main className="mobile-category-main">
          <section className="mobile-category-intro liquid-glass frosted-panel">
            <p>{snapshotMeta.label} · {snapshotMeta.detail}</p>
            <h1>{activeMeta.title}</h1>
            <span>{activeIntro}</span>
          </section>

          <div className="mobile-list-controls">
            <span>{activeCountLabel}</span>
            <span className="verified-only-label">仅展示官方已核验</span>
          </div>

          <div className="mobile-signal-list">
            {activeItems.length ? activeItems.map((item) => (
              <button key={item.id} type="button" className="mobile-signal-card liquid-glass frosted-panel" onClick={() => handleOpen(item)}>
                <p className="row-meta">
                  <b>{item.vendor}</b>
                  <em className="confidence-badge is-verified">官方已核验</em>
                  {item.topic ? <span>{item.topic}</span> : null}
                  <time>{item.effectiveAt ? `生效 ${formatCalendarDate(item.effectiveAt)}` : formatDate(item.time)}</time>
                </p>
                <h2>{item.title}</h2>
                <p>{item.note}</p>
                <span className="mobile-card-link">查看官方原文 <ArrowIcon /></span>
              </button>
            )) : <div className="empty">暂时还没有信号。</div>}
          </div>

          {tab === "notices" ? (
            <section className="mobile-portals">
              <div className="mobile-section-heading"><p>{"// OFFICIAL WATCHLIST"}</p><h2>官方监测入口</h2></div>
              <div className="mobile-portal-list">
                {OFFICIAL_NOTICES.map((item) => (
                  <button key={item.id} type="button" className="mobile-portal-card liquid-glass" onClick={() => handleOpen(item)}>
                    <span>{item.vendor}</span><b>{item.title}</b><ArrowIcon />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </main>
        {toast ? <div className="toast liquid-glass" role="status">{toast}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-page">
      <section className="hero-stage" aria-label="Agent Pulse 概览">
        <FadingVideo className="stage-video hero-video" src={HERO_VIDEO} mobileSrc={HERO_VIDEO_MOBILE} poster={HERO_POSTER} />

        <header className="floating-nav">
          <CornerLinks />
          <nav className="main-nav liquid-glass" aria-label="情报分类">
            <button type="button" onClick={() => selectFeed("models", true)}>模型发布</button>
            <button type="button" onClick={() => selectFeed("agents", true)}>Agent 工具</button>
            <button type="button" onClick={() => selectFeed("notices", true)}>弃用提醒</button>
            <button type="button" className="nav-refresh" onClick={() => void loadData(true)} disabled={isRefreshing} title="读取 GitHub main 已完成采集的最新公开快照">
              {isRefreshing ? "读取中" : "读取快照"}<ArrowIcon />
            </button>
          </nav>
          <div className="nav-spacer" aria-hidden="true" />
        </header>

        <div className="hero-content">
          <div className="live-badge liquid-glass reveal reveal-one">
            <span>{snapshotMeta.label}</span>
            <p>{snapshotMeta.detail}</p>
          </div>
          <h1 className="hero-title reveal reveal-two">见微知著</h1>
          <p className="hero-copy reveal reveal-three">把散落在官网、GitHub 与 npm 的模型发布、Agent 工具更新和弃用提醒，整理成可核验、可直达原文的更新清单。</p>
          <div className="hero-actions reveal reveal-four">
            <button type="button" className="liquid-glass-strong primary-action" onClick={() => void loadData(true)} disabled={isRefreshing} title="读取 GitHub main 已完成采集的最新公开快照">
              {isRefreshing ? "正在读取" : "读取最新快照"}<ArrowIcon />
            </button>
            <button type="button" className="quiet-action" onClick={scrollToSignals}>查看更新清单<PlayIcon /></button>
          </div>
          <div className="hero-stats reveal reveal-five" aria-label="实时概览">
            <div className="stat-card liquid-glass frosted-panel">
              <ClockIcon />
              <strong>{totalSignals}</strong>
              <span>已收录已核验更新</span>
            </div>
            <div className="stat-card liquid-glass frosted-panel">
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
        <div className="signals-media" aria-hidden="true">
          <FadingVideo className="stage-video signals-video" src={SIGNALS_VIDEO} mobileSrc={SIGNALS_VIDEO_MOBILE} poster={SIGNALS_POSTER} loadStrategy="visible" />
        </div>
        <div className="signals-content">
          <div className="signals-heading">
            <p>{"// Official update stream"}</p>
            <h2>重要更新，<br />集中抵达。</h2>
          </div>

          <section className="snapshot-summary liquid-glass frosted-panel" aria-labelledby="snapshot-summary-title">
            <div className="summary-intro">
              <p className="summary-kicker">最新与热点 · 仅展示已核验信号</p>
              <h3 id="snapshot-summary-title">现在值得关注</h3>
              <p className="summary-copy">
                不再按分类各取一条，而是结合发布时间、24 小时热度和迁移影响筛选。最近于 {relativeTime(current.checked_at || current.generated_at, clockTick)}完成检查，内容于 {relativeTime(current.content_updated_at || current.generated_at, clockTick)}更新。
              </p>
            </div>
            <div className="summary-stack">
              {snapshotHighlights.map(({ label, item, reason, signal }, index) => (
                <button
                  key={`${label}-${item.id}`}
                  type="button"
                  className={`summary-row ${index === 0 ? "is-featured" : ""}`}
                  onClick={() => handleOpen(item)}
                  title={item.href}
                >
                  <span className="summary-index">{String(index + 1).padStart(2, "0")}</span>
                  <div className="summary-body">
                    <p><span>{label}</span><b>{item.vendor}</b><em>{signal}</em></p>
                    <h4>{item.title}</h4>
                    <p className="summary-note">{reason}</p>
                  </div>
                  <span className="summary-open">原文<ArrowIcon /></span>
                </button>
              ))}
            </div>
          </section>

          <div className="feed-card-grid">
            {feedCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`feed-card liquid-glass frosted-panel ${tab === card.id ? "is-active" : ""}`}
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

          <section className="signal-list liquid-glass frosted-panel" aria-live="polite">
            <div className="signal-list-head">
              <div>
                <p>{"// "}{activeMeta.label}</p>
                <h3>{activeMeta.title}</h3>
              </div>
              <div className="signal-list-controls">
                <span>{activeCountLabel}</span>
                <span className="verified-only-label">仅展示官方已核验</span>
              </div>
            </div>
            <p className="signal-list-intro">{activeIntro}</p>
            <div className="signal-rows">
              {activeItems.length ? activeItems.map((item) => (
                <button key={item.id} type="button" className="signal-row" onClick={() => handleOpen(item)} title={item.href}>
                  <div>
                    <p className="row-meta">
                      <b>{item.vendor}</b>
                      <em className="confidence-badge is-verified">官方已核验</em>
                      {item.topic ? <span>{item.topic}</span> : null}
                      <time>{item.effectiveAt ? `生效 ${formatCalendarDate(item.effectiveAt)}` : formatDate(item.time)}</time>
                    </p>
                    <h4>{item.title}</h4>
                    <p className="row-note">{item.note}</p>
                  </div>
                  <span className="row-open">查看原文<ArrowIcon /></span>
                </button>
              )) : <div className="empty">暂时还没有信号。</div>}
            </div>
            {tab === "notices" ? (
              <div className="portal-section">
                <div className="portal-section-head">
                  <div><p>{"// Official watchlist"}</p><h4>官方监测入口</h4></div>
                  <span>{OFFICIAL_NOTICES.length} 个固定入口，不计入更新数量</span>
                </div>
                <div className="portal-grid">
                  {OFFICIAL_NOTICES.map((item) => (
                    <button key={item.id} type="button" className="portal-link" onClick={() => handleOpen(item)} title={item.href}>
                      <span>{item.vendor}</span>
                      <b>{item.title}</b>
                      <ArrowIcon />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      {toast ? <div className="toast liquid-glass" role="status">{toast}</div> : null}
    </div>
  );
}
