import { createClaudeClient, readClaudeApiKey } from "../src/claude.ts";

const key = readClaudeApiKey();
if (!key) {
  process.stderr.write("claude-planner=missing\n");
  process.exitCode = 2;
} else if (!key.startsWith("sk-ant-")) {
  process.stderr.write("claude-planner=bad-prefix\n");
  process.exitCode = 2;
} else {
  const client = createClaudeClient(key);
  const text = await client.complete("Reply with the single word pong.", "ping");
  process.stdout.write(`claude-planner=ready\nclaude-reply=${text.trim().slice(0, 40)}\n`);
}
