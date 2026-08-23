import { spawnSync } from "node:child_process";

import { DEFAULT_ORIGIN_REPO, ORIGIN_GIT_HOST, ORIGIN_REMOTE, type ForgeRepo } from "./forge.ts";

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

export function originSetupText(slug: string = DEFAULT_ORIGIN_REPO): string {
  return `Origin CLI

${ORIGIN_INSTALL}
origin auth login

To clone an existing repo

${originCloneCommand(slug)}
# or use git directly
${originGitCloneCommand(slug)}

To push a local project

${originPushInitCommands(slug).join("\n")}
`;
}
