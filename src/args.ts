export interface CliArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string>;
  switches: Set<string>;
}

export function parseArgs(argv: string[]): CliArgs {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token) continue;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        switches.add(key);
      } else {
        flags.set(key, next);
        i += 1;
      }
    } else {
      positionals.push(token);
    }
  }
  return { command, positionals, flags, switches };
}

export function intFlag(args: CliArgs, name: string, fallback: number): number {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

export function floatFlag(args: CliArgs, name: string, fallback: number): number {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative number`);
  }
  return value;
}
