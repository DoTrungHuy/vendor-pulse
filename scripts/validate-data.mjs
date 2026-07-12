import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dataRoot = new URL("../public/data/", import.meta.url);

async function json(name) {
  try {
    return JSON.parse(await readFile(new URL(name, dataRoot), "utf8"));
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`);
  }
}

function validTime(value, label, nullable = false) {
  if (nullable && value === null) return;
  assert.equal(typeof value, "string", `${label} must be a timestamp string`);
  assert.ok(Number.isFinite(new Date(value).getTime()), `${label} must be a valid timestamp`);
}

export async function validatePublishedData() {
  const [bundle, current, events, snapshots, status] = await Promise.all(
    ["bundle.json", "current.json", "events.json", "snapshots.json", "status.json"].map(json),
  );

  assert.equal(bundle.schema_version, 1);
  assert.equal(current.schema_version, 1);
  assert.equal(status.schema_version, 1);
  assert.match(bundle.snapshot_id, /^snapshot-[a-f0-9]{10}$/);
  assert.equal(bundle.snapshot_id, current.snapshot_id);
  assert.equal(bundle.snapshot_id, status.snapshot_id);
  assert.deepEqual(bundle.current, current, "bundle current data must match current.json");
  assert.deepEqual(bundle.events, events, "bundle events must match events.json");
  assert.deepEqual(bundle.health, status, "bundle health must match status.json");

  validTime(current.checked_at, "current.checked_at");
  validTime(current.content_updated_at, "current.content_updated_at");
  validTime(current.last_full_success_at, "current.last_full_success_at", true);
  assert.ok(["ok", "degraded", "error"].includes(current.status));
  assert.ok(Array.isArray(current.tools) && current.tools.length > 0, "tools must not be empty");
  assert.ok(Array.isArray(current.models) && current.models.length > 0, "models must not be empty");
  assert.ok(Array.isArray(events), "events must be an array");
  assert.ok(Array.isArray(snapshots), "snapshots must be an array");

  assert.equal(status.overall, current.status);
  assert.ok(Array.isArray(status.review_queue), "status review queue must be available for internal inspection");
  assert.equal(typeof status.publication_stats, "object", "publication stats must be available for internal inspection");
  assert.equal(status.source_counts.total, Object.keys(status.sources).length);
  assert.equal(status.source_counts.healthy + status.source_counts.failed, status.source_counts.total);
  Object.entries(status.sources).forEach(([key, source]) => {
    assert.ok(["ok", "error"].includes(source.status), `${key} has an invalid status`);
    assert.equal(typeof source.required, "boolean", `${key} must declare whether it is required`);
    assert.ok(Number.isInteger(source.consecutive_failures) && source.consecutive_failures >= 0, `${key} has invalid failure count`);
    validTime(source.checked_at, `${key}.checked_at`);
    validTime(source.last_success_at, `${key}.last_success_at`, true);
  });

  events.forEach((event) => {
    assert.equal(event.source_status, "official", `${event.id} must come from an official source`);
    assert.ok(["complete", "partial"].includes(event.information_status), `${event.id} must expose information completeness`);
    assert.ok(["stable", "prerelease", null].includes(event.release_channel), `${event.id} has an invalid release channel`);
    assert.equal(event.id, event.canonical_key, `${event.id} must use its canonical identity`);
    assert.match(event.source_url, /^https:\/\//, `${event.id} must link to HTTPS`);
    validTime(event.occurred_at, `${event.id}.occurred_at`);
    validTime(event.detected_at, `${event.id}.detected_at`);
    assert.equal(typeof event.summary, "string", `${event.id}.summary must be available`);
    assert.ok(event.summary.length >= 12, `${event.id}.summary must be meaningful`);
    if (event.information_status === "partial" && event.type !== "deprecation") assert.equal(event.published_at || null, null, `${event.id} partial releases must not invent publish dates`);
  });
  assert.equal(status.publication_stats.complete + status.publication_stats.partial, events.length);

  return { snapshot_id: bundle.snapshot_id, status: current.status, events: events.length };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  validatePublishedData()
    .then((result) => console.log(`Validated ${result.snapshot_id}: ${result.events} events, health ${result.status}.`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
