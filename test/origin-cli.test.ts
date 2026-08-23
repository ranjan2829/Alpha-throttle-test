import assert from "node:assert/strict";
import { test } from "node:test";

import { originCloneCommand, originGitCloneCommand, originPushInitCommands, originSetupText } from "../src/throttle/origin-cli.ts";

test("Origin setup text matches the official CLI flow", () => {
  const text = originSetupText("allocations/Alpha-throttle-test");
  assert.match(text, /downloads\.cursor\.com\/origin\/install\.sh/);
  assert.match(text, /origin auth login/);
  assert.equal(originCloneCommand(), "origin repo clone 'allocations/Alpha-throttle-test'");
  assert.equal(
    originGitCloneCommand(),
    "git clone 'https://origin.cursor.com/allocations/Alpha-throttle-test'",
  );
  assert.deepEqual(originPushInitCommands(), [
    "git init -b 'main'",
    "git remote add origin 'https://origin.cursor.com/allocations/Alpha-throttle-test'",
    "git add .",
    'git commit -m "Initial commit"',
    "git push -u origin 'main'",
  ]);
});
