// AI Gateway smoke test — plain "provider/model" strings route through the
// Vercel AI Gateway automatically; auth comes from VERCEL_OIDC_TOKEN pulled
// by `vercel env pull` (no provider API keys needed).
//
// Run: node --env-file=.env.local index.mjs

import { streamText } from "ai";

const result = streamText({
  model: "openai/gpt-5.5",
  prompt: "Explain quantum computing in simple terms.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
process.stdout.write("\n");
