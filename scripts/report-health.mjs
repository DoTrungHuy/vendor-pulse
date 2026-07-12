import { appendFile, readFile } from "node:fs/promises";

const status = JSON.parse(await readFile(new URL("../public/data/status.json", import.meta.url), "utf8"));
const failed = status.failed_sources || [];
const alerts = status.alert_sources || [];
const criticalFailure = (status.source_counts?.required_failed || 0) > 0;

const summary = [
  "## Agent Pulse collection health",
  "",
  `- Snapshot: \`${status.snapshot_id}\``,
  `- Overall: **${status.overall}**`,
  `- Sources: ${status.source_counts?.healthy || 0}/${status.source_counts?.total || 0} healthy`,
  `- Required failures: ${status.source_counts?.required_failed || 0}`,
  `- Content updated: ${status.content_updated_at || "unknown"}`,
  "",
  ...(failed.length
    ? ["### Failed sources", "", ...failed.map((source) => `- \`${source.key}\`: ${source.error} (${source.consecutive_failures} consecutive)`)]
    : ["All configured sources responded successfully."]),
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
else console.log(summary);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `overall=${status.overall}`,
    `critical_failure=${criticalFailure}`,
    `alert_required=${alerts.length > 0}`,
    `alert_sources=${alerts.join(",")}`,
    "",
  ].join("\n"), "utf8");
}
