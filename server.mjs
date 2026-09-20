// Jev model router. Run: node --env-file=.env server.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { experimental_evaluate as evaluate, generateText } from "ai";

export const JEV = "typesafe-ai/jev";
export const TIERS = {
  nano:     { model: "openai/gpt-5-nano",          rubric: "Greeting, small talk, a one-line fact, or a trivial request" },
  fast:     { model: "google/gemini-3-flash",      rubric: "A simple question or short task with a clear answer; no deep reasoning" },
  balanced: { model: "anthropic/claude-sonnet-5",  rubric: "Needs real reasoning, planning, a careful explanation, or writing code" },
  frontier: { model: "anthropic/claude-fable-5.1", rubric: "Large multi-step or high-stakes work where a wrong answer is costly: a complete system, hard math, a long document" },
};
export const TIER_QUESTION = {
  type: "choice",
  instructions: "Which model tier is the cheapest one that can answer this user message well?",
  criteria: Object.fromEntries(Object.entries(TIERS).map(([k, v]) => [k, v.rubric])),
};
const MAX_CHARS = 20000;
const MAX_BODY = 65536;

export async function chooseTier(message, evaluateFn = evaluate) {
  const t0 = performance.now();
  const ev = await evaluateFn({ model: JEV, state: { user_message: message }, questions: { tier: TIER_QUESTION } });
  const { choice: tier, probabilities } = ev.answers.tier;
  if (!TIERS[tier]) throw new Error(`unknown tier ${tier}`);
  return { tier, model: TIERS[tier].model, probabilities, confidence: ev.providerMetadata?.typesafe?.confidence?.tier ?? null, jevMs: Math.round(performance.now() - t0), usd: Number(ev.providerMetadata?.gateway?.marketCost ?? 0) };
}

export async function route(message, evaluateFn = evaluate, generateFn = generateText) {
  const picked = await chooseTier(message, evaluateFn);
  const t1 = performance.now();
  let reply = "", replyError = null, usage = null;
  try { const gen = await generateFn({ model: picked.model, prompt: message }); reply = gen.text; usage = gen.usage; }
  catch (e) { replyError = String(e.message ?? e); }
  return { ...picked, replyMs: Math.round(performance.now() - t1), reply, replyError, usage };
}

const offlineTier = (message) => {
  const s = message.toLowerCase();
  if (/^(hi|hello|hey|thanks)\b|capital of|convert \d|define .+ in one sentence/.test(s)) return "nano";
  if (/high.stakes|complete production|hard theorem|medical device/.test(s)) return "frontier";
  if (/rewrite this short/.test(s)) return "fast";
  if (/implement|design|plan|debug|code|explain|rewrite/.test(s)) return "balanced";
  return "fast";
};
export const offlineEvaluate = async ({ state }) => {
  const choice = offlineTier(state.user_message), probabilities = { nano: 0.03, fast: 0.03, balanced: 0.03, frontier: 0.03 };
  probabilities[choice] = 0.91;
  return { answers: { tier: { type: "choice", choice, probabilities } }, providerMetadata: { typesafe: { confidence: { tier: 0.9 } }, gateway: { marketCost: "0" } } };
};
export const offlineGenerate = async ({ model, prompt }) => ({ text: `Offline reply from ${model}: ${prompt}`, usage: null });

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY) { const e = new Error("request body is too large"); e.statusCode = 413; throw e; }
  }
  return JSON.parse(body || "{}");
}

export async function createApp({ evaluateFn = evaluate, generateFn = generateText } = {}) {
  const html = await readFile(new URL("./index.html", import.meta.url));
  return createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/chat") {
      res.setHeader("content-type", "application/json");
      try {
        const { message } = await readJson(req);
        if (typeof message !== "string" || !message.trim()) throw new Error("message must be a non-empty string");
        res.end(JSON.stringify(await route(message.trim().slice(0, MAX_CHARS), evaluateFn, generateFn)));
      } catch (e) {
        res.statusCode = e.statusCode ?? 400;
        res.end(JSON.stringify({ error: String(e.message ?? e) }));
      }
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });
}

async function check() {
  const server = await createApp({ evaluateFn: offlineEvaluate, generateFn: offlineGenerate });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.match(await (await fetch(base)).text(), /<title>/);
    const r = await (await fetch(`${base}/chat`, { method: "POST", body: JSON.stringify({ message: "Design a retrying queue" }) })).json();
    assert.equal(r.tier, "balanced");
    assert.match(r.reply, /Offline reply/);
    assert.equal((await fetch(`${base}/chat`, { method: "POST", body: "{}" })).status, 400);
    console.log("offline server check passed");
  } finally { server.close(); }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) await check();
  else {
    const offline = process.argv.includes("--offline");
    const server = await createApp(offline ? { evaluateFn: offlineEvaluate, generateFn: offlineGenerate } : {});
    server.listen(3000, "127.0.0.1", () => console.log("http://127.0.0.1:3000"));
  }
}
