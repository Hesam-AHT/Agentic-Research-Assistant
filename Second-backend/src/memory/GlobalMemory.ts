// Agentic-Research-Assistant/src/memory/GlobalMemory.ts
//
// NEW GlobalMemory implementation (Redis-backed)
// - Simple + reliable
// - Exports: GlobalMemory class + Namespaces constant
// - Session-scoped keys: mem:{sessionId}:{namespace}
// - JSON read/write/append + TTL support
//
// Install:
//   npm i ioredis
//
// Env:
//   REDIS_URL=redis://localhost:6379
//   (optional) REDIS_PREFIX=mem

import Redis from "ioredis";

export const Namespaces = {
  profile: "profile",
  blacklist: "blacklist",
  working: "working",
  trace: "trace",
  kb_state: "kb_state",
  main_paper: "main_paper",
} as const;

export type Namespace =
  | (typeof Namespaces)[keyof typeof Namespaces]
  | string;

export type GlobalMemoryOpts = {
  redisUrl?: string;
  prefix?: string; // default: process.env.REDIS_PREFIX || "mem"
  defaultTtlSec?: number; // default: 7 days
};

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class GlobalMemory {
  private redis: Redis;
  private prefix: string;
  private defaultTtlSec: number;
  private sessionId: string;

  constructor(sessionId: string, opts: GlobalMemoryOpts = {}) {
    this.sessionId = sessionId;

    // CHANGED BY DATE: 2026-01-02 - Added fallback for REDIS_URL to avoid runtime errors
    const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";

    if (!redisUrl) {
      console.warn("[GlobalMemory] WARNING: REDIS_URL not set and fallback failed.");
      // Still throw if somehow fallback is empty, but "redis://localhost:6379" protects us
      throw new Error("GlobalMemory: Missing REDIS_URL");
    }
    // CHANGED BY DATE: 2026-01-02 - Added fallback for REDIS_URL to avoid runtime errors
    this.redis = new Redis(redisUrl);
    this.prefix = opts.prefix ?? process.env.REDIS_PREFIX ?? "mem";
    this.defaultTtlSec = opts.defaultTtlSec ?? 60 * 60 * 24 * 7;
  }

  private k(ns: string) {
    return `${this.prefix}:${this.sessionId}:${ns}`;
  }

  /** Read JSON value. Returns null if missing or invalid JSON. */
  async read<T>(namespace: Namespace): Promise<T | null> {
    const raw = await this.redis.get(this.k(namespace));
    if (!raw) return null;
    return safeParse<T>(raw);
  }

  /**
   * Write JSON value.
   * ttlSec:
   * - undefined → use defaultTtlSec
   * - 0 → no TTL (persist)
   */
  async write(namespace: Namespace, value: any, ttlSec?: number): Promise<void> {
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
   * Append to array (creates array if missing).
   * Preserves existing TTL if key already has TTL.
   */
  async append(namespace: Namespace, item: any, ttlSec?: number): Promise<number> {
    const key = this.k(namespace);

    const raw = await this.redis.get(key);
    const arr = raw ? safeParse<any[]>(raw) ?? [] : [];
    arr.push(item);

    const data = JSON.stringify(arr);

    // preserve existing TTL if present
    const existingTtl = await this.redis.ttl(key); // -2 missing, -1 no ttl, >=0 seconds

    if (existingTtl > 0) {
      await this.redis.set(key, data, "EX", existingTtl);
    } else if (existingTtl === -1) {
      await this.redis.set(key, data);
    } else {
      const ttl = typeof ttlSec === "number" ? ttlSec : this.defaultTtlSec;
      if (ttl === 0) await this.redis.set(key, data);
      else await this.redis.set(key, data, "EX", ttl);
    }

    return arr.length;
  }

  /** Delete a namespace key. */
  async del(namespace: Namespace): Promise<void> {
    await this.redis.del(this.k(namespace));
  }

  /** Check if a namespace exists. */
  async exists(namespace: Namespace): Promise<boolean> {
    return (await this.redis.exists(this.k(namespace))) === 1;
  }

  /** Get TTL (seconds). -2 missing, -1 no TTL, otherwise seconds. */
  async ttl(namespace: Namespace): Promise<number> {
    return await this.redis.ttl(this.k(namespace));
  }

  /** Close redis connection (optional). */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
