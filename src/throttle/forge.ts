export type ForgeKind = "origin" | "github";

/** Personal Origin namespace. Not the allocations org. */
export const DEFAULT_ORIGIN_NAMESPACE = "ranjan-rgb";
/** Personal Origin home. Created by origin-setup after login. */
export const DEFAULT_ORIGIN_REPO = `${DEFAULT_ORIGIN_NAMESPACE}/Alpha-throttle-test`;
export const DEFAULT_GITHUB_MIRROR = "ranjan2829/Alpha-throttle-test";
export const DEFAULT_ORIGIN_REPO_NAME = "Alpha-throttle-test";
export const ORIGIN_GIT_HOST = "https://origin.cursor.com";
export const ORIGIN_REMOTE = "cursor-origin";

export interface ForgeRepo {
  forge: ForgeKind;
  owner: string;
  repo: string;
  slug: string;
  httpsUrl: string;
  remote: string;
}

export function parseRepoSlug(value: string, forge: ForgeKind): ForgeRepo {
  const trimmed = value.trim().replace(/\.git$/, "");
  const originMatch = trimmed.match(/(?:origin\.cursor\.com[:/])([^/]+)\/([^/]+)$/);
  const githubMatch = trimmed.match(/(?:github\.com[:/])([^/]+)\/([^/]+)$/);
  const slugMatch = trimmed.match(/^([^/]+)\/([^/]+)$/);
  const pair = originMatch ?? (forge === "github" ? githubMatch : slugMatch) ?? githubMatch ?? slugMatch;
  if (!pair?.[1] || !pair[2]) {
    throw new Error(`cannot parse repo slug from ${value}`);
  }
  const owner = pair[1];
  const repo = pair[2];
  const slug = `${owner}/${repo}`;
  if (forge === "origin" || originMatch) {
    return {
      forge: "origin",
      owner,
      repo,
      slug,
      httpsUrl: `${ORIGIN_GIT_HOST}/${slug}`,
      remote: ORIGIN_REMOTE,
    };
  }
  return {
    forge: "github",
    owner,
    repo,
    slug,
    httpsUrl: `https://github.com/${slug}`,
    remote: "origin",
  };
}

export function compareUrlFor(repo: ForgeRepo, base: string, head: string): string {
  if (repo.forge === "origin") {
    return `${ORIGIN_GIT_HOST}/${repo.slug}/compare/${base}...${head}`;
  }
  return `https://github.com/${repo.slug}/compare/${base}...${head}`;
}

export function parseForgeFlag(value: string | undefined): ForgeKind {
  if (value === undefined || value === "origin") return "origin";
  if (value === "github") return "github";
  throw new Error("--forge must be origin | github");
}
