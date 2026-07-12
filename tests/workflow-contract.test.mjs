import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/collect.yml", import.meta.url), "utf8");

test("collector workflow has staggered schedule recovery and cooldown", () => {
  assert.match(workflow, /cron: "17 \* \* \* \*"/);
  assert.match(workflow, /cron: "47 \* \* \* \*"/);
  assert.match(workflow, /COLLECTOR_COOLDOWN_MINUTES/);
  assert.match(workflow, /agent-pulse-collector/);
});

test("collector workflow validates before committing and reports health", () => {
  const validation = workflow.indexOf("npm run validate:data");
  const commit = workflow.indexOf("git commit -m");
  assert.ok(validation >= 0 && validation < commit);
  assert.match(workflow, /npm run report:health/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /critical_failure/);
});

test("collector workflow rebases and never force pushes", () => {
  assert.match(workflow, /git pull --rebase origin main/);
  assert.doesNotMatch(workflow, /--force|force-with-lease/);
});
