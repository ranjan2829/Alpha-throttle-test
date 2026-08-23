import { spawnSync } from "node:child_process";

import { productBriefText } from "./brief.ts";
import {
  DEFAULT_GITHUB_MIRROR,
  DEFAULT_ORIGIN_NAMESPACE,
  DEFAULT_ORIGIN_REPO,
  ORIGIN_GIT_HOST,
  ORIGIN_REMOTE,
  type ForgeRepo,
} from "./forge.ts";

export const ORIGIN_INSTALL = "curl -fsSL https://downloads.cursor.com/origin/install.sh | sh";

export function originCloneCommand(slug: string = DEFAULT_ORIGIN_REPO): string {
  return `origin repo clone '${slug}'`;
}

export function originGitCloneCommand(slug: string = DEFAULT_ORIGIN_REPO): string {
  return `git clone '${ORIGIN_GIT_HOST}/${slug}'`;
}

export function originPushInitCommands(slug: string = DEFAULT_ORIGIN_REPO): string[] {
  return [
    "git init -b 'main'",
    `git remote add origin '${ORIGIN_GIT_HOST}/${slug}'`,
    "git add .",
    'git commit -m "Initial commit"',
    "git push -u origin 'main'",
  ];
}

export function originAuthStatus(): { ok: boolean; detail: string } {
  const result = spawnSync("origin", ["auth", "status"], { encoding: "utf8" });
  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status === 0 && !/not logged in/i.test(detail)) {
    return { ok: true, detail: detail || "logged in" };
  }
  return {
    ok: false,
    detail: detail || "Not logged in. Run `origin auth login` or set CURSOR_API_KEY.",
  };
}

export function addCursorOriginRemote(repoDir: string, forgeRepo: ForgeRepo): string {
  const remotes = spawnSync("git", ["remote"], { cwd: repoDir, encoding: "utf8" });
  const names = (remotes.stdout ?? "").split(/\s+/).filter((name) => name.length > 0);
  if (names.includes(ORIGIN_REMOTE)) {
    spawnSync("git", ["remote", "set-url", ORIGIN_REMOTE, forgeRepo.httpsUrl], {
      cwd: repoDir,
      encoding: "utf8",
    });
    return `updated ${ORIGIN_REMOTE} -> ${forgeRepo.httpsUrl}`;
  }
  const added = spawnSync("git", ["remote", "add", ORIGIN_REMOTE, forgeRepo.httpsUrl], {
    cwd: repoDir,
    encoding: "utf8",
  });
  if (added.status !== 0) {
    throw new Error(added.stderr.trim() || `failed to add ${ORIGIN_REMOTE}`);
  }
  return `added ${ORIGIN_REMOTE} -> ${forgeRepo.httpsUrl}`;
}

export function originMirrorCommand(
  githubSlug: string = DEFAULT_GITHUB_MIRROR,
  namespace: string | null = DEFAULT_ORIGIN_NAMESPACE,
): string {
  if (namespace === null) {
    return `origin repo create-mirrored '${githubSlug}'`;
  }
  return `origin repo create-mirrored '${githubSlug}' --namespace ${namespace}`;
}

export function originSetupText(slug: string = DEFAULT_ORIGIN_REPO): string {
  return `${productBriefText()}
The Origin repo is not created yet. GitHub ${DEFAULT_GITHUB_MIRROR} exists.
Host it on the personal Origin account ranjan-rgb — not the allocations org.
${slug} is the personal Origin target, not a live clone URL until origin-setup succeeds.

Origin CLI

${ORIGIN_INSTALL}
origin auth login
npx tsx src/cli.ts origin-setup

# personal account only — no allocations org
${originMirrorCommand()}
${originMirrorCommand(DEFAULT_GITHUB_MIRROR, null)}
origin repo create Alpha-throttle-test
origin auth setup-git --local
git remote add ${ORIGIN_REMOTE} '${ORIGIN_GIT_HOST}/${slug}'
git push -u ${ORIGIN_REMOTE} HEAD

Clone only after origin-setup reports hosted: yes

${originCloneCommand(slug)}
# or use git directly
${originGitCloneCommand(slug)}

To push a local project into an Origin repo that already exists

${originPushInitCommands(slug).join("\n")}
`;
}
