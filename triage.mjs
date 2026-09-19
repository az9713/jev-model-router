// Email triage with Jev. Run: node --env-file=.env triage.mjs .ignore/emails.json [--limit N] [--raw]
// Input: JSON array of { id, date, from, subject, snippet }. Output: <input>.triage.json + a table on stdout.
import { readFile, writeFile } from "node:fs/promises";
import { experimental_evaluate as evaluate } from "ai";

// ---- Review these. Everything else is plumbing. ----
const JEV = "typesafe-ai/jev";
const QUESTIONS = {
  category: {
    type: "choice",
    instructions: "What kind of email is this, received by the user?",
    criteria: {
      security_alert: "An account security or sign-in notice from a service the user uses",
      receipt: "A payment receipt, invoice, or billing notice",
      service_notice: "A product, policy, or terms change from a service the user uses",
      newsletter: "A digest, marketing, or promotional mailing",
      personal_reminder: "A reminder or task sent by the user or a family member to the user",
      business_inquiry: "A person or company asking the user for work, a contract, or a deal",
      other: "None of the above",
    },
  },
  importance: {
    type: "score",
    instructions: "How important is it that the user personally reads this email?",
    criteria: [
      "ignore: no action and no information the user needs",
      "low: informational only; fine to skim later",
      "medium: worth reading this week",
      "high: needs an action or a reply within a few days",
      "critical: needs an action today; money, security, or a deadline is at stake",
      "insane: needs a response within 30 minutes or bad things happen",
    ],
  },
  brand_deal: { type: "boolean", instructions: "Does this email mention a sponsorship or brand deal opportunity for the user?" },
  scam: { type: "boolean", instructions: "Does this email look like a scam, phishing, or something untrustworthy?" },
};

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
const raw = args.includes("--raw");
const emails = JSON.parse(await readFile(file, "utf8")).slice(0, limit);

const out = [];
for (const e of emails) {
  const ev = await evaluate({ model: JEV, state: { from: e.from, subject: e.subject, date: e.date, snippet: e.snippet }, questions: QUESTIONS });
  if (raw) console.log(JSON.stringify({ answers: ev.answers, meta: ev.providerMetadata }, null, 2));
  const a = ev.answers, conf = ev.providerMetadata?.typesafe?.confidence ?? {};
  out.push({
    id: e.id, date: e.date, from: e.from, subject: e.subject,
    category: a.category.choice, categoryConf: conf.category ?? null,
    importance: a.importance.score, importanceConf: conf.importance ?? null,
    brandDeal: a.brand_deal.probability,
    scam: a.scam.probability,
  });
}

// ponytail: a --limit run must not clobber the full output file
if (limit === Infinity) await writeFile(file.replace(/\.json$/, ".triage.json"), JSON.stringify(out, null, 2));
const f = (n) => (n == null ? "  -  " : n.toFixed(2));
console.log("imp  conf  scam  deal  category           date        from                          subject");
for (const r of [...out].sort((x, y) => y.importance - x.importance))
  console.log(`${f(r.importance)} ${f(r.importanceConf)} ${f(r.scam)} ${f(r.brandDeal)}  ${r.category.padEnd(18)} ${r.date}  ${r.from.slice(0, 28).padEnd(28)}  ${r.subject.slice(0, 60)}`);
