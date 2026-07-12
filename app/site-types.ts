export type SourceHealth = "ok" | "degraded" | "stale" | "error" | "bootstrapping";

export type SourceCounts = {
  total: number;
  healthy: number;
  failed: number;
  required: number;
  required_healthy: number;
  required_failed: number;
};

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
  latest_release: {
    tag: string;
    title: string;
    published_at: string;
    url: string;
    release_channel?: "stable" | "prerelease" | null;
    summary?: string | null;
  } | null;
  release_cadence_30d: { count: number; median_days: number | null };
  npm: { package: string; version: string | null; weekly_downloads: number | null } | null;
  status: SourceHealth;
};

export type SignalRecord = {
  title: string;
  occurred_at: string;
  published_at?: string | null;
  effective_at?: string | null;
  detected_at?: string | null;
  source_url: string;
  feed_id: string | null;
  confidence?: "verified" | "needs_review";
  source_status?: "official";
  information_status?: "complete" | "partial";
  release_channel?: "stable" | "prerelease" | null;
  summary?: string | null;
};

export type ModelFeedStatus = {
  id: string;
  label: string;
  kind: "model" | "deprecation" | string;
  url: string;
  status: SourceHealth | "ok" | "error" | "stale";
  checked_at: string | null;
  error: string | null;
  required?: boolean;
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
  canonical_key?: string;
  item_id: string;
  item_name: string;
  type: "release" | "model" | "deprecation" | "source_changed";
  title: string;
  occurred_at: string;
  published_at?: string | null;
  effective_at?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  detected_at?: string | null;
  source_url: string;
  provider?: string | null;
  feed_id?: string | null;
  confidence?: "verified" | "needs_review";
  source_status?: "official";
  information_status?: "complete" | "partial";
  release_channel?: "stable" | "prerelease" | null;
  summary?: string | null;
};

export type CurrentData = {
  schema_version?: number;
  snapshot_id?: string | null;
  generated_at: string | null;
  checked_at?: string | null;
  content_updated_at?: string | null;
  last_full_success_at?: string | null;
  timezone: string;
  tools: ToolRecord[];
  models: ModelRecord[];
  status: SourceHealth;
  source_counts?: SourceCounts;
};

export type SnapshotHealth = {
  schema_version: number;
  snapshot_id: string;
  checked_at: string;
  content_updated_at: string;
  last_full_success_at: string | null;
  overall: SourceHealth;
  source_counts: SourceCounts;
  publication_stats?: {
    complete: number;
    partial: number;
    stable: number;
    prerelease: number;
    quarantined: number;
  };
};

export type SnapshotBundle = {
  schema_version: number;
  snapshot_id: string;
  checked_at: string;
  current: CurrentData;
  events: EventRecord[];
  health: SnapshotHealth;
};

export type SnapshotSeries = { tool_id: string; points: Array<{ captured_at: string; stars: number }> };

export type Capability = {
  tool_id: string;
  tool_name: string;
  verified_at: string;
  axes: Array<{ id: string; name: string; count: number; items: Array<{ label: string; enabled: boolean; source_url: string }> }>;
};
