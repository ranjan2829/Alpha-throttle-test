import assert from "node:assert/strict";
import { test } from "node:test";

import {
  originCloneCommand,
  originGitCloneCommand,
  originMirrorCommand,
  originPushInitCommands,
  originSetupText,
} from "../src/throttle/origin-cli.ts";

test("Origin setup text targets the personal ranjan-rgb account", () => {
  const text = originSetupText("ranjan-rgb/Alpha-throttle-test");
  assert.match(text, /Make a recursive agent on cursor origin/);
  assert.match(text, /ranjan-rgb/);
  assert.match(text, /not the allocations org/);
  assert.match(text, /downloads\.cursor\.com\/origin\/install\.sh/);
  assert.match(text, /origin auth login/);
  assert.match(text, /origin repo create-mirrored 'ranjan2829\/Alpha-throttle-test' --namespace ranjan-rgb/);
  assert.equal(originCloneCommand(), "origin repo clone 'ranjan-rgb/Alpha-throttle-test'");
  assert.equal(
    originGitCloneCommand(),
    "git clone 'https://origin.cursor.com/ranjan-rgb/Alpha-throttle-test'",
  );
  assert.equal(
    originMirrorCommand(),
    "origin repo create-mirrored 'ranjan2829/Alpha-throttle-test' --namespace ranjan-rgb",
  );
  assert.deepEqual(originPushInitCommands(), [
    "git init -b 'main'",
    "git remote add origin 'https://origin.cursor.com/ranjan-rgb/Alpha-throttle-test'",
    "git add .",
    'git commit -m "Initial commit"',
    "git push -u origin 'main'",
  ]);
});
