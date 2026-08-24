import { DEFAULT_COMMIT_EMAIL, DEFAULT_COMMIT_NAME, resolveGitIdentity } from "./throttle/git.ts";

export const UI_COMMIT_NAME = DEFAULT_COMMIT_NAME;
export const UI_COMMIT_EMAIL = DEFAULT_COMMIT_EMAIL;
export const UI_COMMIT_STAMP = `${UI_COMMIT_NAME} <${UI_COMMIT_EMAIL}>`;

export interface GitUser {
  name: string;
  email: string;
}

export function uiCommitIdentity(env: NodeJS.ProcessEnv = process.env): GitUser {
  return resolveGitIdentity(env);
}

export function tokenFromGitRemote(url: string): string | null {
  const match = url.match(/x-access-token:([^@]+)@/i);
  return match?.[1] ?? null;
}

export function formatGitStamp(user: GitUser): string {
  return `${user.name} <${user.email}>`;
}

export function gitCommitArgv(user: GitUser, message: string): string[] {
  return [
    "git",
    `-c`,
    `user.name=${user.name}`,
    `-c`,
    `user.email=${user.email}`,
    "commit",
    "-m",
    message,
  ];
}

export function gitCommitEnv(user: GitUser, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_AUTHOR_NAME: user.name,
    GIT_AUTHOR_EMAIL: user.email,
    GIT_COMMITTER_NAME: user.name,
    GIT_COMMITTER_EMAIL: user.email,
  };
}
