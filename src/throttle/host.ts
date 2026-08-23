import { spawnSync } from "node:child_process";

import { kingsleyBriefText } from "./brief.ts";
import {
  DEFAULT_GITHUB_MIRROR,
  DEFAULT_ORIGIN_REPO,
  DEFAULT_ORIGIN_REPO_NAME,
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

export type OriginHostStep =
  | "remote"
  | "auth"
  | "setup-git"
  | "view"
  | "create-mirrored"
  | "create-mirrored-default"
  | "create"
  | "retarget"
  | "push";

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
  repoName: string;
  install: string;
  login: string;
  createMirrored: string[];
  createMirroredDefault: string[];
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
  exists: boolean;
  auth: { ok: boolean; detail: string };
  plan: OriginHostPlan;
  steps: OriginHostStepResult[];
  hostedSlug: string | null;
  text: string;
}

export function parseCreatedOriginSlug(text: string): string | null {
  const url = text.match(/origin\.cursor\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (url?.[1]) {
    return url[1].replace(/\.git$/, "");
  }
  const jsonOrg = text.match(/"org"\s*:\s*"([^"]+)"/);
  const jsonName = text.match(/"name"\s*:\s*"([^"]+)"/);
  if (jsonOrg?.[1] && jsonName?.[1]) {
    return `${jsonOrg[1]}/${jsonName[1]}`;
  }
  return null;
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
    repoName: origin.repo,
    install: ORIGIN_INSTALL,
    login: "origin auth login",
    createMirrored: ["origin", "repo", "create-mirrored", githubSlug, "--namespace", origin.owner],
    createMirroredDefault: ["origin", "repo", "create-mirrored", githubSlug],
    createEmpty: ["origin", "repo", "create", origin.repo || DEFAULT_ORIGIN_REPO_NAME],
    setupGit: ["origin", "auth", "setup-git", "--local"],
    clone: originCloneCommand(origin.slug),
    gitClone: originGitCloneCommand(origin.slug),
    addRemote: ["git", "remote", "add", ORIGIN_REMOTE, `${ORIGIN_GIT_HOST}/${origin.slug}`],
    pushHead: ["git", "push", "-u", ORIGIN_REMOTE, "HEAD"],
  };
}

export function originHostText(plan: OriginHostPlan = originHostPlan()): string {
  return `${kingsleyBriefText()}
The Origin repo is not created yet.

GitHub (exists): ${plan.githubSlug}
  https://github.com/${plan.githubSlug}
Origin target (create after login): ${plan.originSlug}
  ${ORIGIN_GIT_HOST}/${plan.originSlug}

Do not clone the Origin URL until origin-setup reports hosted: yes.

${plan.install}
${plan.login}

# Personal Origin account only (ranjan-rgb), not the allocations org
${plan.createMirrored.join(" ")}
${plan.createMirroredDefault.join(" ")}
${plan.createEmpty.join(" ")}
${plan.setupGit.join(" ")}
git remote add ${ORIGIN_REMOTE} '${ORIGIN_GIT_HOST}/${plan.originSlug}'
${plan.pushHead.join(" ")}

# Clone only after the repo exists
${plan.clone}
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
  const steps: OriginHostStepResult[] = [];

  let hostedSlug: string | null = null;
  const remoteDetail = addCursorOriginRemote(options.repoDir, parseRepoSlug(plan.originSlug, "origin"));
  steps.push({ step: "remote", ok: true, detail: remoteDetail });

  const auth = options.authStatus ?? originAuthStatus();
  steps.push({ step: "auth", ok: auth.ok, detail: auth.detail });

  if (!auth.ok) {
    return finish(false, false, false, auth, plan, steps, null);
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
    detail: trimOutput(viewed) || (viewOk ? plan.originSlug : `${plan.originSlug} does not exist`),
  });

  let hosted = viewOk;
  if (viewOk) {
    hostedSlug = parseCreatedOriginSlug(trimOutput(viewed)) ?? plan.originSlug;
  } else {
    const mirrored = runner(plan.createMirrored, options.repoDir);
    const mirroredOk = mirrored.status === 0;
    steps.push({
      step: "create-mirrored",
      ok: mirroredOk,
      detail: trimOutput(mirrored) || plan.createMirrored.join(" "),
    });
    hosted = mirroredOk;
    if (mirroredOk) {
      hostedSlug = parseCreatedOriginSlug(trimOutput(mirrored)) ?? plan.originSlug;
    } else {
      const fallback = runner(plan.createMirroredDefault, options.repoDir);
      const fallbackOk = fallback.status === 0;
      steps.push({
        step: "create-mirrored-default",
        ok: fallbackOk,
        detail: trimOutput(fallback) || plan.createMirroredDefault.join(" "),
      });
      hosted = fallbackOk;
      if (fallbackOk) {
        hostedSlug = parseCreatedOriginSlug(trimOutput(fallback));
      } else {
        const created = runner(plan.createEmpty, options.repoDir);
        const createdOk = created.status === 0;
        steps.push({
          step: "create",
          ok: createdOk,
          detail: trimOutput(created) || plan.createEmpty.join(" "),
        });
        hosted = createdOk;
        if (createdOk) {
          hostedSlug = parseCreatedOriginSlug(trimOutput(created));
        }
      }
    }
  }

  if (hosted && hostedSlug && hostedSlug !== plan.originSlug) {
    const retarget = addCursorOriginRemote(options.repoDir, parseRepoSlug(hostedSlug, "origin"));
    steps.push({ step: "retarget", ok: true, detail: retarget });
  }

  if (push && hosted) {
    const pushed = runner(plan.pushHead, options.repoDir);
    steps.push({
      step: "push",
      ok: pushed.status === 0,
      detail: trimOutput(pushed) || plan.pushHead.join(" "),
    });
    return finish(pushed.status === 0, hosted, viewOk, auth, plan, steps, hostedSlug);
  }

  return finish(hosted, hosted, viewOk, auth, plan, steps, hostedSlug);
}

function trimOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function finish(
  ok: boolean,
  hosted: boolean,
  exists: boolean,
  auth: { ok: boolean; detail: string },
  plan: OriginHostPlan,
  steps: OriginHostStepResult[],
  hostedSlug: string | null,
): OriginHostResult {
  const stepLines = steps.map((row) => `${row.ok ? "ok" : "need"}  ${row.step}: ${row.detail}`).join("\n");
  const text = `${originHostText(plan)}\n${stepLines}\n\nexists: ${exists ? "yes" : "no"}  hosted: ${hosted ? "yes" : "no"}  auth: ${auth.ok ? "ok" : "needed"}  slug: ${hostedSlug ?? "(none)"}\n`;
  return { ok, hosted, exists, auth, plan, steps, hostedSlug, text };
}
