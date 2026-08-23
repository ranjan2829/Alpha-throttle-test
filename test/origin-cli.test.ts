import assert from "node:assert/strict";
import { test } from "node:test";

import {
  originCloneCommand,
  originGitCloneCommand,
  originMirrorCommand,
  originPushInitCommands,
  originSetupText,
} from "../src/throttle/origin-cli.ts";

test("Origin setup text matches the official CLI flow", () => {
  const text = originSetupText("allocations/Alpha-throttle-test");
  assert.match(text, /Kingsley Advani/);
  assert.match(text, /Make a recursive agent on cursor origin/);
  assert.match(text, /downloads\.cursor\.com\/origin\/install\.sh/);
  assert.match(text, /origin auth login/);
  assert.match(text, /origin repo create-mirrored 'ranjan2829\/Alpha-throttle-test' --namespace allocations/);
  assert.equal(originCloneCommand(), "origin repo clone 'allocations/Alpha-throttle-test'");
  assert.equal(
    originGitCloneCommand(),
    "git clone 'https://origin.cursor.com/allocations/Alpha-throttle-test'",
  );
  assert.equal(
    originMirrorCommand(),
    "origin repo create-mirrored 'ranjan2829/Alpha-throttle-test' --namespace allocations",
  );
  assert.deepEqual(originPushInitCommands(), [
    "git init -b 'main'",
    "git remote add origin 'https://origin.cursor.com/allocations/Alpha-throttle-test'",
    "git add .",
    'git commit -m "Initial commit"',
    "git push -u origin 'main'",
  ]);
});
