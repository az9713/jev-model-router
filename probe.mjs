// One-shot probe: does the gateway accept typesafe-ai/jev and what comes back?
import { experimental_evaluate as evaluate } from "ai";

const id = process.argv[2] ?? "typesafe-ai/jev";
const r = await evaluate({
  model: id,
  state: "Hey, I'm Riley.",
  questions: {
    tier: {
      type: "choice",
      instructions: "Which model tier should answer this message?",
      criteria: {
        nano: "Greeting or trivial chat",
        balanced: "Needs real reasoning or code",
      },
    },
    is_greeting: { type: "boolean", instructions: "Is this only a greeting?" },
  },
});
console.log(JSON.stringify({ answers: r.answers, usage: r.usage, warnings: r.warnings, meta: r.providerMetadata, body: r.response?.body }, null, 2));
