import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RUN_DIR = fileURLToPath(new URL("./.reprocheck/runs/", import.meta.url));
const validId = (id) => typeof id === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);

export function saveRun(record, directory = RUN_DIR) {
  if (!validId(record.id)) throw new Error("Invalid run record id");
  mkdirSync(directory, { recursive: true });
  const target = join(directory, `${record.id}.json`);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
  renameSync(temporary, target);
}

export function getSavedRun(id, directory = RUN_DIR) {
  if (!validId(id)) return null;
  try {
    const target = join(directory, `${id}.json`);
    if (statSync(target).size > 2 * 1024 * 1024) return null;
    const record = JSON.parse(readFileSync(target, "utf8"));
    if (!record || record.id !== id || !Array.isArray(record.steps)
      || ["repository", "commit", "status", "startedAt", "log"].some((key) => typeof record[key] !== "string")) return null;
    if (record.status === "RUNNING") {
      return { ...record, status: "INTERRUPTED", finishedAt: null,
        steps: record.steps.map((step) => step.status === "RUNNING" ? { ...step, status: "INTERRUPTED" } : step),
        verification: { ...record.verification, status: "INCOMPLETE" },
        diagnosis: "The local server restarted before observing completion. The last snapshot is saved, but the final outcome is unknown; the container timeout still applies.",
      };
    }
    return record;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export function listSavedRuns(directory = RUN_DIR) {
  try {
    // ponytail: single-user local JSON history; use indexed storage if thousands of runs make listing slow.
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && validId(entry.name.slice(0, -5)))
      .map((entry) => ({ id: entry.name.slice(0, -5), time: statSync(join(directory, entry.name)).mtimeMs }))
      .sort((left, right) => right.time - left.time).slice(0, 30)
      .map(({ id }) => getSavedRun(id, directory)).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
