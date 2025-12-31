<<<<<<< HEAD
import * as fs from "fs";
import * as path from "path";

export class GlobalMemory {
  private sessionId: string;
  private memoryDir: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.memoryDir = path.join(process.cwd(), ".memory");
    
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  private getSessionPath(): string {
    return path.join(this.memoryDir, `${this.sessionId}.json`);
  }

  async read<T = any>(key: string): Promise<T | null> {
    try {
      const sessionPath = this.getSessionPath();
      if (!fs.existsSync(sessionPath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      const item = data[key];
      
      if (!item) {
        return null;
      }

      // Check expiration
      if (item.expiresAt && new Date(item.expiresAt) < new Date()) {
        delete data[key];
        fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
        return null;
      }

      return item.value as T;
    } catch (error) {
      console.error(`[GlobalMemory] Error reading key ${key}:`, error);
      return null;
    }
  }

  async write<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const sessionPath = this.getSessionPath();
      let data: Record<string, any> = {};

      if (fs.existsSync(sessionPath)) {
        data = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      }

      const item: any = {
        value,
        updatedAt: new Date().toISOString(),
      };

      if (ttlSeconds) {
        item.expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      }

      data[key] = item;
      fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[GlobalMemory] Error writing key ${key}:`, error);
    }
  }

  async append<T = any>(key: string, value: T): Promise<void> {
    try {
      const existing = (await this.read<T[]>(key)) || [];
      existing.push(value);
      await this.write(key, existing);
    } catch (error) {
      console.error(`[GlobalMemory] Error appending to key ${key}:`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const sessionPath = this.getSessionPath();
      if (!fs.existsSync(sessionPath)) {
        return;
      }

      const data = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      delete data[key];
      fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[GlobalMemory] Error deleting key ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      const sessionPath = this.getSessionPath();
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
      }
    } catch (error) {
      console.error(`[GlobalMemory] Error clearing session:`, error);
    }
  }
}

=======
// Agentic-Research-Assistant/src/memory/GlobalMemory.ts
//
// GlobalMemory: A0-controlled shared memory using Redis.
// - One place to read/write/append session-scoped memory
// - Supports namespaces (profile, blacklist, working, trace, kb_state, agent:*)
// - Optional permission gating (A0 can enforce least-privilege for A1/A2)
// - JSON-safe operations
//
// Install:
//   npm i ioredis
//
// Env:
//   REDIS_URL=redis://localhost:6379

import Redis from "ioredis";

export type Actor = "A0" | "A1" | "A2";
export type Op = "read" | "write" | "append";

export type GlobalMemoryOptions = {
  redisUrl?: string;
  prefix?: string; // default: "mem"
  defaultTtlSec?: number; // default: 7 days for session data
  enablePermissions?: boolean; // default: true
};

const DEFAULT_TTL = 60 * 60 * 24 * 7;

const DEFAULT_PERMS = {
  A0: { read: ["*"], write: ["*"], append: ["*"] },
  A1: {
    read: ["profile", "blacklist", "kb_state", "working", "agent:A1:*"],
    write: ["kb_state", "agent:A1:*"],
    append: ["agent:A1:*"],
  },
  A2: {
    read: ["profile", "working", "agent:A2:*"],
    write: ["agent:A2:*"],
    append: ["agent:A2:*"],
  },
} as const;

function matches(pattern: string, ns: string) {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return ns.startsWith(pattern.slice(0, -1));
  return pattern === ns;
}

function isAllowed(
  perms: typeof DEFAULT_PERMS,
  actor: Actor,
  op: Op,
  namespace: string
) {
  const rules = perms[actor]?.[op] ?? [];
  return rules.some((p) => matches(p, namespace));
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * GlobalMemory
 *
 * Session-scoped memory with namespaces.
 * Key format:
 *   {prefix}:{sessionId}:{namespace}
 *
 * Examples:
 *   mem:sess_01:profile
 *   mem:sess_01:blacklist
 *   mem:sess_01:working
 *   mem:sess_01:trace
 *   mem:sess_01:agent:A1:scratch
 */
export class GlobalMemory {
  private redis: Redis;
  private prefix: string;
  private defaultTtlSec: number;
  private enablePermissions: boolean;
  private perms: typeof DEFAULT_PERMS;

  constructor(private sessionId: string, opts: GlobalMemoryOptions = {}) {
    const redisUrl = opts.redisUrl ?? process.env.REDIS_URL;
    if (!redisUrl) throw new Error("GlobalMemory: Missing REDIS_URL");

    this.redis = new Redis(redisUrl);
    this.prefix = opts.prefix ?? "mem";
    this.defaultTtlSec = opts.defaultTtlSec ?? DEFAULT_TTL;
    this.enablePermissions = opts.enablePermissions ?? true;
    this.perms = DEFAULT_PERMS;
  }

  /* -----------------------------
     Key helpers
  ----------------------------- */

  private k(namespace: string) {
    return `${this.prefix}:${this.sessionId}:${namespace}`;
  }

  private assert(actor: Actor, op: Op, namespace: string) {
    if (!this.enablePermissions) return;
    if (!isAllowed(this.perms, actor, op, namespace)) {
      throw new Error(`GlobalMemory: DENIED ${actor} cannot ${op} namespace="${namespace}"`);
    }
  }

  /* -----------------------------
     Core operations
  ----------------------------- */

  /**
   * Read JSON value at namespace.
   * Returns null if missing OR invalid JSON.
   */
  async read<T>(namespace: string, actor: Actor = "A0"): Promise<T | null> {
    this.assert(actor, "read", namespace);
    const raw = await this.redis.get(this.k(namespace));
    if (!raw) return null;
    return safeJsonParse<T>(raw);
  }

  /**
   * Write JSON value at namespace.
   * ttlSec defaults to GlobalMemory defaultTtlSec.
   * Pass ttlSec = 0 to persist without TTL.
   */
  async write(
    namespace: string,
    value: any,
    actor: Actor = "A0",
    ttlSec?: number
  ): Promise<void> {
    this.assert(actor, "write", namespace);
    const key = this.k(namespace);
    const data = JSON.stringify(value);

    const ttl = typeof ttlSec === "number" ? ttlSec : this.defaultTtlSec;

    if (ttl === 0) {
      await this.redis.set(key, data);
    } else {
      await this.redis.set(key, data, "EX", ttl);
    }
  }

  /**
   * Append item to JSON array at namespace.
   * Creates the array if missing.
   * Keeps TTL behavior:
   * - if key exists with TTL, TTL remains
   * - if key missing, applies default TTL (or ttlSec override)
   */
  async append(
    namespace: string,
    item: any,
    actor: Actor = "A0",
    ttlSec?: number
  ): Promise<number> {
    this.assert(actor, "append", namespace);

    const key = this.k(namespace);

    // Read existing list
    const raw = await this.redis.get(key);
    const arr = raw ? (safeJsonParse<any[]>(raw) ?? []) : [];
    arr.push(item);

    // Preserve TTL if it exists
    const existingTtl = await this.redis.ttl(key); // -2 missing, -1 no TTL, >=0 seconds
    const data = JSON.stringify(arr);

    if (existingTtl > 0) {
      // key had TTL; reset it to preserve remaining TTL
      await this.redis.set(key, data, "EX", existingTtl);
    } else if (existingTtl === -1) {
      // no TTL
      await this.redis.set(key, data);
    } else {
      // missing key
      const ttl = typeof ttlSec === "number" ? ttlSec : this.defaultTtlSec;
      if (ttl === 0) await this.redis.set(key, data);
      else await this.redis.set(key, data, "EX", ttl);
    }

    return arr.length;
  }

  /**
   * Delete a namespace key.
   */
  async del(namespace: string, actor: Actor = "A0"): Promise<void> {
    this.assert(actor, "write", namespace);
    await this.redis.del(this.k(namespace));
  }

  /**
   * Check whether a namespace exists.
   */
  async exists(namespace: string, actor: Actor = "A0"): Promise<boolean> {
    this.assert(actor, "read", namespace);
    const n = await this.redis.exists(this.k(namespace));
    return n === 1;
  }

  /**
   * Get TTL (seconds). Returns:
   * -2 if missing, -1 if no TTL, otherwise seconds.
   */
  async ttl(namespace: string, actor: Actor = "A0"): Promise<number> {
    this.assert(actor, "read", namespace);
    return await this.redis.ttl(this.k(namespace));
  }

  /**
   * Close Redis connection (optional).
   */
  async close() {
    await this.redis.quit();
  }
}

/* -----------------------------
   Optional helpers (namespaces)
----------------------------- */

export const Namespaces = {
  profile: "profile",
  blacklist: "blacklist",
  working: "working",
  trace: "trace",
  kb_state: "kb_state",
  main_paper: "main_paper",
} as const;
>>>>>>> V-0.0.1
