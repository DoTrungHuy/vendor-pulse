export type SourceHealth = "ok" | "stale" | "error" | "bootstrapping";

export type ToolRecord = {
  id: string;
  name: string;
  repo: string;
  repo_url: string;
  official_url: string;
  x_url: string;
  stars: number | null;
  stars_delta_24h: number | null;
  stars_delta_7d: number | null;
  latest_release: { tag: string; title: string; published_at: string; url: string } | null;
  release_cadence_30d: { count: number; median_days: number | null };
  npm: { package: string; version: string | null; weekly_downloads: number | null } | null;
  status: SourceHealth;
};

export type SignalRecord = {
  title: string;
  occurred_at: string;
  source_url: string;
  feed_id: string | null;
  confidence?: "verified" | "needs_review";
};

export type ModelFeedStatus = {
  id: string;
  label: string;
  kind: "model" | "deprecation" | string;
  url: string;
  status: SourceHealth | "ok" | "error" | "stale";
  checked_at: string | null;
  error: string | null;
};

export type ModelRecord = {
  id: string;
  name: string;
  provider: string;
  source_url: string;
  title: string | null;
  occurred_at: string | null;
  status: SourceHealth;
  latest_model?: SignalRecord | null;
  latest_policy?: SignalRecord | null;
  feeds?: ModelFeedStatus[];
};

export type EventRecord = {
  id: string;
  item_id: string;
  item_name: string;
  type: "release" | "model" | "deprecation" | "source_changed";
  title: string;
  occurred_at: string;
  source_url: string;
  provider?: string | null;
  feed_id?: string | null;
  confidence?: "verified" | "needs_review";
};

export type CurrentData = {
  generated_at: string | null;
  timezone: string;
  tools: ToolRecord[];
  models: ModelRecord[];
  status: SourceHealth;
};

export type SnapshotSeries = { tool_id: string; points: Array<{ captured_at: string; stars: number }> };

export type Capability = {
  tool_id: string;
  tool_name: string;
  verified_at: string;
  axes: Array<{ id: string; name: string; count: number; items: Array<{ label: string; enabled: boolean; source_url: string }> }>;
};
