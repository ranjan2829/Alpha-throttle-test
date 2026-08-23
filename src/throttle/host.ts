import { spawnSync } from "node:child_process";

import { kingsleyBriefText } from "./brief.ts";
import {
  DEFAULT_GITHUB_MIRROR,
  DEFAULT_ORIGIN_REPO,
  ORIGIN_GIT_HOST,
  ORIGIN_REMOTE,
  parseRepoSlug,
} from "./forge.ts";
import {
  addCursorOriginRemote,
  ORIGIN_INSTALL,
  originAuthStatus,
  originCloneCommand,
  originGitCloneCommand,
} from "./origin-cli.ts";

export type OriginHostStep = "remote" | "auth" | "setup-git" | "view" | "create-mirrored" | "create" | "push";

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (argv: readonly string[], cwd: string) => CommandResult;

export interface OriginHostPlan {
  originSlug: string;
  githubSlug: string;
  namespace: string;
  install: string;
  login: string;
  createMirrored: string[];
  createEmpty: string[];
  setupGit: string[];
  clone: string;
  gitClone: string;
  addRemote: string[];
  pushHead: string[];
}

export interface OriginHostStepResult {
  step: OriginHostStep;
  ok: boolean;
  detail: string;
}

export interface OriginHostResult {
  ok: boolean;
  hosted: boolean;
  auth: { ok: boolean; detail: string };
  plan: OriginHostPlan;
  steps: OriginHostStepResult[];
  text: string;
}

export function originHostPlan(
  originSlug: string = DEFAULT_ORIGIN_REPO,
  githubSlug: string = DEFAULT_GITHUB_MIRROR,
): OriginHostPlan {
  const origin = parseRepoSlug(originSlug, "origin");
  return {
    originSlug: origin.slug,
    githubSlug,
    namespace: origin.owner,
    install: ORIGIN_INSTALL,
    login: "origin auth login",
    createMirrored: ["origin", "repo", "create-mirrored", githubSlug, "--namespace", origin.owner],
    createEmpty: ["origin", "repo", "create", origin.slug],
    setupGit: ["origin", "auth", "setup-git", "--local"],
    clone: originCloneCommand(origin.slug),
    gitClone: originGitCloneCommand(origin.slug),
    addRemote: ["git", "remote", "add", ORIGIN_REMOTE, `${ORIGIN_GIT_HOST}/${origin.slug}`],
    pushHead: ["git", "push", "-u", ORIGIN_REMOTE, "HEAD"],
  };
}

export function originHostText(plan: OriginHostPlan = originHostPlan()): string {
  return `${kingsleyBriefText()}
Host the recursive agent on Cursor Origin.

${plan.install}
${plan.login}

# Mirror the GitHub Alpha-throttle-test tree onto Origin
${plan.createMirrored.join(" ")}
${plan.setupGit.join(" ")}
git remote add ${ORIGIN_REMOTE} '${ORIGIN_GIT_HOST}/${plan.originSlug}'
${plan.pushHead.join(" ")}

# Or clone if the Origin repo already exists
${plan.clone}
# or use git directly
${plan.gitClone}
`;
}

export function defaultCommandRunner(argv: readonly string[], cwd: string): CommandResult {
  const [cmd, ...args] = argv;
  if (!cmd) {
    return { status: 1, stdout: "", stderr: "empty command" };
  }
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runOriginHost(options: {
  repoDir: string;
  originSlug?: string;
  githubSlug?: string;
  push?: boolean;
  runner?: CommandRunner;
  authStatus?: { ok: boolean; detail: string };
}): OriginHostResult {
  const originSlug = options.originSlug ?? DEFAULT_ORIGIN_REPO;
  const githubSlug = options.githubSlug ?? DEFAULT_GITHUB_MIRROR;
  const push = options.push ?? true;
  const runner = options.runner ?? defaultCommandRunner;
  const plan = originHostPlan(originSlug, githubSlug);
  const forgeRepo = parseRepoSlug(plan.originSlug, "origin");
  const steps: OriginHostStepResult[] = [];

  const remoteDetail = addCursorOriginRemote(options.repoDir, forgeRepo);
  steps.push({ step: "remote", ok: true, detail: remoteDetail });

  const auth = options.authStatus ?? originAuthStatus();
  steps.push({ step: "auth", ok: auth.ok, detail: auth.detail });

  if (!auth.ok) {
    return finish(false, false, auth, plan, steps);
  }

  const setup = runner(plan.setupGit, options.repoDir);
  steps.push({
    step: "setup-git",
    ok: setup.status === 0,
    detail: trimOutput(setup) || "origin auth setup-git --local",
  });

  const viewed = runner(["origin", "repo", "view", plan.originSlug, "--json", "org,name,defaultBranch"], options.repoDir);
  const viewOk = viewed.status === 0;
  steps.push({
    step: "view",
    ok: viewOk,
    detail: trimOutput(viewed) || (viewOk ? plan.originSlug : "Origin repo not found"),
  });

  let hosted = viewOk;
  if (!viewOk) {
    const mirrored = runner(plan.createMirrored, options.repoDir);
    const mirroredOk = mirrored.status === 0;
    steps.push({
      step: "create-mirrored",
      ok: mirroredOk,
      detail: trimOutput(mirrored) || plan.createMirrored.join(" "),
    });
    hosted = mirroredOk;
    if (!mirroredOk) {
      const created = runner(plan.createEmpty, options.repoDir);
      const createdOk = created.status === 0;
      steps.push({
        step: "create",
        ok: createdOk,
        detail: trimOutput(created) || plan.createEmpty.join(" "),
      });
      hosted = createdOk;
    }
  }

  if (push && hosted) {
    const pushed = runner(plan.pushHead, options.repoDir);
    steps.push({
      step: "push",
      ok: pushed.status === 0,
      detail: trimOutput(pushed) || plan.pushHead.join(" "),
    });
    return finish(pushed.status === 0, hosted, auth, plan, steps);
  }

  return finish(hosted, hosted, auth, plan, steps);
}

function trimOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function finish(
  ok: boolean,
  hosted: boolean,
  auth: { ok: boolean; detail: string },
  plan: OriginHostPlan,
  steps: OriginHostStepResult[],
): OriginHostResult {
  const stepLines = steps.map((row) => `${row.ok ? "ok" : "need"}  ${row.step}: ${row.detail}`).join("\n");
  const text = `${originHostText(plan)}\n${stepLines}\n\nhosted: ${hosted ? "yes" : "no"}  auth: ${auth.ok ? "ok" : "needed"}\n`;
  return { ok, hosted, auth, plan, steps, text };
}
