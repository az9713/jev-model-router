// Held-out router evaluation. Default is deterministic and free; --live calls Jev but never calls a reply model.
import { readFile, writeFile } from "node:fs/promises";
import { experimental_evaluate as evaluate } from "ai";
import { chooseTier, offlineEvaluate } from "./server.mjs";

const args = process.argv.slice(2), live = args.includes("--live");
const outArg = args.indexOf("--out"), outFile = outArg >= 0 ? args[outArg + 1] : null;
const cases = JSON.parse(await readFile(new URL("./eval/cases.json", import.meta.url), "utf8"));
const rows = [];
for (const c of cases) {
  const started = performance.now();
  try {
    const r = await chooseTier(c.message, live ? evaluate : offlineEvaluate);
    rows.push({ caseId: c.id, input: c.message, expected: c.expected, actual: r.tier, passed: r.tier === c.expected, confidence: r.confidence, probabilities: r.probabilities, latencyMs: Math.round(performance.now() - started), costUsd: r.usd, attempts: 1, error: null, mode: live ? "live" : "offline" });
  } catch (e) {
    rows.push({ caseId: c.id, input: c.message, expected: c.expected, actual: null, passed: false, confidence: null, probabilities: null, latencyMs: Math.round(performance.now() - started), costUsd: null, attempts: 1, error: String(e.message ?? e), mode: live ? "live" : "offline" });
  }
}
const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
if (outFile) await writeFile(outFile, jsonl); else process.stdout.write(jsonl);
const passed = rows.filter((r) => r.passed).length;
console.error(`${passed}/${rows.length} passed; ${rows.filter((r) => r.error).length} errors; $${rows.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(6)}`);
if (!live && passed !== rows.length) process.exitCode = 1;
