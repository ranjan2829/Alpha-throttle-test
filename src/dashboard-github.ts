import { tokenFromGitRemote, uiCommitIdentity, type GitUser } from "./dashboard-identity.ts";

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface GithubFileChange {
  path: string;
  content: string;
}

export interface GithubPullRequest {
  number: number;
  url: string;
  head: string;
  sha: string;
}

export function parseRepoRef(slug: string): GithubRepoRef {
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) {
    throw new Error(`invalid repo slug: ${slug}`);
  }
  return { owner, repo };
}

export function githubToken(env: NodeJS.ProcessEnv = process.env, originUrl = ""): string | null {
  const fromEnv = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim() || env.GH_PAT?.trim();
  if (fromEnv) return fromEnv;
  return tokenFromGitRemote(originUrl);
}

export function githubApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return env.GITHUB_API_URL?.trim() || "https://api.github.com";
}

interface GithubJson {
  sha?: string;
  html_url?: string;
  number?: number;
  object?: { sha?: string };
  commit?: { sha?: string; tree?: { sha?: string } };
  tree?: { sha?: string };
  message?: string;
}

export async function githubRequest<T extends GithubJson>(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ranjan-rgb-dashboard-agent",
    },
  };
  if (body) init.body = JSON.stringify(body);
  const response = await fetch(`${githubApiBase(env)}${path}`, init);
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
  if (!response.ok) {
    const detail = parsed.message ?? text.slice(0, 200);
    throw new Error(`GitHub ${method} ${path} ${response.status}: ${detail}`);
  }
  return parsed;
}

export async function resolveBranchHead(
  token: string,
  ref: GithubRepoRef,
  branch: string,
): Promise<{ sha: string; tree: string }> {
  const commit = await githubRequest<GithubJson>(
    token,
    "GET",
    `/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(branch)}`,
  );
  const sha = commit.sha;
  const tree = commit.commit?.tree?.sha ?? commit.tree?.sha;
  if (!sha || !tree) {
    throw new Error(`GitHub commit for ${branch} missing sha/tree`);
  }
  return { sha, tree };
}

export async function createBranchFrom(
  token: string,
  ref: GithubRepoRef,
  branch: string,
  sha: string,
): Promise<void> {
  await githubRequest(token, "POST", `/repos/${ref.owner}/${ref.repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha,
  });
}

export async function commitFilesAs(
  token: string,
  ref: GithubRepoRef,
  options: {
    branch: string;
    message: string;
    files: GithubFileChange[];
    identity?: GitUser;
    parentSha?: string;
    baseTree?: string;
  },
): Promise<string> {
  const identity = options.identity ?? uiCommitIdentity();
  const head =
    options.parentSha && options.baseTree
      ? { sha: options.parentSha, tree: options.baseTree }
      : await resolveBranchHead(token, ref, options.branch);
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of options.files) {
    const blob = await githubRequest<GithubJson>(
      token,
      "POST",
      `/repos/${ref.owner}/${ref.repo}/git/blobs`,
      { content: file.content, encoding: "utf-8" },
    );
    if (!blob.sha) throw new Error(`GitHub blob missing sha for ${file.path}`);
    treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await githubRequest<GithubJson>(
    token,
    "POST",
    `/repos/${ref.owner}/${ref.repo}/git/trees`,
    { base_tree: head.tree, tree: treeEntries },
  );
  if (!tree.sha) throw new Error("GitHub tree missing sha");
  const commit = await githubRequest<GithubJson>(
    token,
    "POST",
    `/repos/${ref.owner}/${ref.repo}/git/commits`,
    {
      message: options.message,
      tree: tree.sha,
      parents: [head.sha],
      author: { name: identity.name, email: identity.email },
      committer: { name: identity.name, email: identity.email },
    },
  );
  if (!commit.sha) throw new Error("GitHub commit missing sha");
  await githubRequest(token, "PATCH", `/repos/${ref.owner}/${ref.repo}/git/refs/heads/${options.branch}`, {
    sha: commit.sha,
    force: false,
  });
  return commit.sha;
}

export async function openPullRequestAs(
  token: string,
  ref: GithubRepoRef,
  options: { title: string; body: string; head: string; base?: string },
): Promise<GithubPullRequest> {
  const created = await githubRequest<GithubJson>(token, "POST", `/repos/${ref.owner}/${ref.repo}/pulls`, {
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base ?? "main",
  });
  if (created.number === undefined || !created.html_url) {
    throw new Error("GitHub pull request missing number/url");
  }
  const sha = created.sha ?? "";
  return { number: created.number, url: created.html_url, head: options.head, sha };
}
