// Jev model router. Run: node --env-file=.env server.mjs   (add --check to self-test)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import assert from "node:assert/strict";
import { experimental_evaluate as evaluate, generateText } from "ai";

// ---- Review these. Everything else is plumbing. ----
const JEV = "typesafe-ai/jev";
const TIERS = {
  nano:     { model: "openai/gpt-5-nano",          rubric: "Greeting, small talk, a one-line fact, or a trivial request" },
  fast:     { model: "google/gemini-3-flash",      rubric: "A simple question or short task with a clear answer; no deep reasoning" },
  balanced: { model: "anthropic/claude-sonnet-5",  rubric: "Needs real reasoning, planning, a careful explanation, or writing code" },
  frontier: { model: "anthropic/claude-fable-5.1", rubric: "Large multi-step or high-stakes work where a wrong answer is costly: a complete system, hard math, a long document" },
};
const TIER_QUESTION = {
  type: "choice",
  instructions: "Which model tier is the cheapest one that can answer this user message well?",
  criteria: Object.fromEntries(Object.entries(TIERS).map(([k, v]) => [k, v.rubric])),
};
const MAX_CHARS = 20000; // ponytail: hard cap keeps state under Jev's 32k-token limit; add tokenizer if long inputs matter

async function route(message) {
  const t0 = performance.now();
  const ev = await evaluate({ model: JEV, state: { user_message: message }, questions: { tier: TIER_QUESTION } });
  const jevMs = Math.round(performance.now() - t0);
  const { choice: tier, probabilities } = ev.answers.tier;
  const confidence = ev.providerMetadata?.typesafe?.confidence?.tier ?? null;
  const model = TIERS[tier].model;
  const t1 = performance.now();
  // ponytail: the reply model may be refused on the gateway free tier; keep Jev's decision visible either way
  let reply = "", replyError = null, usage = null;
  try { const gen = await generateText({ model, prompt: message }); reply = gen.text; usage = gen.usage; }
  catch (e) { replyError = String(e.message ?? e); }
  return { tier, model, probabilities, confidence, jevMs, replyMs: Math.round(performance.now() - t1), reply, replyError, usage };
}

const html = await readFile(new URL("./index.html", import.meta.url));
const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    for await (const c of req) body += c;
    try {
      const { message } = JSON.parse(body);
      if (typeof message !== "string" || !message.trim()) throw new Error("message must be a non-empty string");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(await route(message.slice(0, MAX_CHARS))));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: String(e.message ?? e) }));
    }
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
});

if (process.argv.includes("--check")) {
  server.listen(0);
  await once(server, "listening");
  const base = `http://localhost:${server.address().port}`;
  assert.match(await (await fetch(base)).text(), /<title>/);
  for (const message of [
    "Hey, I'm Riley.",
    "Hey, I'm Riley. I want to build an app that uses AI as a wrapper. Tell me the best way to do it.",
    "Please generate all of the code for this. Make sure it's perfect.",
  ]) {
    const r = await (await fetch(`${base}/chat`, { method: "POST", body: JSON.stringify({ message }) })).json();
    assert.ok(TIERS[r.tier], `unknown tier ${r.tier}: ${r.error}`);
    console.log(`${message.slice(0, 40).padEnd(40)} → ${r.tier.padEnd(8)} conf=${r.confidence} jev=${r.jevMs}ms reply=${r.replyMs}ms ${JSON.stringify(r.probabilities)}${r.replyError ? `\n    reply model ${r.model} failed: ${r.replyError.slice(0, 80)}` : ""}`);
  }
  server.close();
} else {
  server.listen(3000, () => console.log("http://localhost:3000"));
}
