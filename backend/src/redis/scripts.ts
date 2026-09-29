import fs from 'node:fs';
import path from 'node:path';
import type Redis from 'ioredis';

const SCRIPT_DIR = path.join(__dirname, 'scripts');

/** Lua script file name -> number of KEYS it takes. */
const SCRIPTS = {
  reserve: 4,
  release: 4,
  consume: 3,
  complete: 4,
  unlock: 1,
} as const;

export type ScriptName = keyof typeof SCRIPTS;

const commandName = (name: ScriptName) => `fk_${name}`;

// defineCommand uses EVALSHA and reloads the script automatically on NOSCRIPT
export function registerScripts(redis: Redis): void {
  for (const [name, numberOfKeys] of Object.entries(SCRIPTS) as [ScriptName, number][]) {
    const lua = fs.readFileSync(path.join(SCRIPT_DIR, `${name}.lua`), 'utf8');
    redis.defineCommand(commandName(name), { numberOfKeys, lua });
  }
}

type ScriptFn = (...args: (string | number)[]) => Promise<unknown>;

export function runScript<T = unknown>(
  redis: Redis,
  name: ScriptName,
  keys: string[],
  args: (string | number)[],
): Promise<T> {
  const fn = (redis as unknown as Record<string, ScriptFn>)[commandName(name)];
  return fn.call(redis, ...keys, ...args) as Promise<T>;
}

/** Lua scripts reply `{1, ...payload}` on success or `{0, ERROR_CODE}` on a business rejection. */
export type ScriptReply = [1, ...(string | number)[]] | [0, string];
