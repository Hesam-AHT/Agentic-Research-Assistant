import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

type RedisClientType = ReturnType<typeof createClient>;

/**
 * GlobalMemory - Session-based memory management with Redis support
 * Falls back to in-memory Map if Redis is unavailable
 */
export class GlobalMemory {
    private sessionId: string;
    private static redisClient: RedisClientType | null = null;
    private static inMemoryStore: Map<string, { value: any; expiresAt?: number }> = new Map();
    private static redisConnected: boolean = false;
    private static initPromise: Promise<void> | null = null;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
        GlobalMemory.ensureInitialized();
    }

    /**
     * Initialize Redis connection (lazy initialization)
     */
    private static async ensureInitialized(): Promise<void> {
        if (GlobalMemory.initPromise) {
            return GlobalMemory.initPromise;
        }

        GlobalMemory.initPromise = (async () => {
            if (GlobalMemory.redisClient) {
                return;
            }

            const redisUrl = process.env.REDIS_URL;

            if (!redisUrl) {
                console.log("[GlobalMemory] No REDIS_URL found, using in-memory storage");
                return;
            }

            try {
                GlobalMemory.redisClient = createClient({ url: redisUrl });

                GlobalMemory.redisClient.on("error", (err) => {
                    console.error("[GlobalMemory] Redis error:", err);
                    GlobalMemory.redisConnected = false;
                });

                GlobalMemory.redisClient.on("connect", () => {
                    console.log("[GlobalMemory] Redis connected");
                    GlobalMemory.redisConnected = true;
                });

                await GlobalMemory.redisClient.connect();
            } catch (error) {
                console.error("[GlobalMemory] Failed to connect to Redis, falling back to in-memory:", error);
                GlobalMemory.redisClient = null;
                GlobalMemory.redisConnected = false;
            }
        })();

        return GlobalMemory.initPromise;
    }

    /**
     * Generate namespaced key for session
     */
    private key(name: string): string {
        return `session:${this.sessionId}:${name}`;
    }

    /**
     * Read a value from memory
     */
    async read<T = any>(name: string): Promise<T | null> {
        await GlobalMemory.ensureInitialized();

        const fullKey = this.key(name);

        // Try Redis first
        if (GlobalMemory.redisConnected && GlobalMemory.redisClient) {
            try {
                const value = await GlobalMemory.redisClient.get(fullKey);
                if (value === null) return null;
                return JSON.parse(value) as T;
            } catch (error) {
                console.error("[GlobalMemory] Redis read error:", error);
                // Fall through to in-memory
            }
        }

        // Fallback to in-memory
        const entry = GlobalMemory.inMemoryStore.get(fullKey);
        if (!entry) return null;

        // Check expiration
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            GlobalMemory.inMemoryStore.delete(fullKey);
            return null;
        }

        return entry.value as T;
    }

    /**
     * Write a value to memory with optional TTL (in seconds)
     */
    async write(name: string, value: any, ttlSeconds?: number): Promise<void> {
        await GlobalMemory.ensureInitialized();

        const fullKey = this.key(name);
        const serialized = JSON.stringify(value);

        // Try Redis first
        if (GlobalMemory.redisConnected && GlobalMemory.redisClient) {
            try {
                if (ttlSeconds) {
                    await GlobalMemory.redisClient.setEx(fullKey, ttlSeconds, serialized);
                } else {
                    await GlobalMemory.redisClient.set(fullKey, serialized);
                }
                return;
            } catch (error) {
                console.error("[GlobalMemory] Redis write error:", error);
                // Fall through to in-memory
            }
        }

        // Fallback to in-memory
        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
        GlobalMemory.inMemoryStore.set(fullKey, { value, expiresAt });
    }

    /**
     * Append to an array in memory
     */
    async append(name: string, item: any): Promise<void> {
        const current = (await this.read<any[]>(name)) || [];
        current.push(item);
        await this.write(name, current);
    }

    /**
     * Delete a value from memory
     */
    async delete(name: string): Promise<void> {
        await GlobalMemory.ensureInitialized();

        const fullKey = this.key(name);

        // Try Redis first
        if (GlobalMemory.redisConnected && GlobalMemory.redisClient) {
            try {
                await GlobalMemory.redisClient.del(fullKey);
                return;
            } catch (error) {
                console.error("[GlobalMemory] Redis delete error:", error);
                // Fall through to in-memory
            }
        }

        // Fallback to in-memory
        GlobalMemory.inMemoryStore.delete(fullKey);
    }

    /**
     * Clear all keys for this session
     */
    async clearSession(): Promise<void> {
        await GlobalMemory.ensureInitialized();

        const pattern = this.key("*");

        // Try Redis first
        if (GlobalMemory.redisConnected && GlobalMemory.redisClient) {
            try {
                const keys = await GlobalMemory.redisClient.keys(pattern);
                if (keys.length > 0) {
                    await GlobalMemory.redisClient.del(keys);
                }
                return;
            } catch (error) {
                console.error("[GlobalMemory] Redis clearSession error:", error);
                // Fall through to in-memory
            }
        }

        // Fallback to in-memory
        const prefix = `session:${this.sessionId}:`;
        for (const key of GlobalMemory.inMemoryStore.keys()) {
            if (key.startsWith(prefix)) {
                GlobalMemory.inMemoryStore.delete(key);
            }
        }
    }

    /**
     * Cleanup expired in-memory entries (should be called periodically)
     */
    static cleanupExpired(): void {
        const now = Date.now();
        for (const [key, entry] of GlobalMemory.inMemoryStore.entries()) {
            if (entry.expiresAt && now > entry.expiresAt) {
                GlobalMemory.inMemoryStore.delete(key);
            }
        }
    }

    /**
     * Disconnect Redis client (call on shutdown)
     */
    static async disconnect(): Promise<void> {
        if (GlobalMemory.redisClient) {
            await GlobalMemory.redisClient.quit();
            GlobalMemory.redisClient = null;
            GlobalMemory.redisConnected = false;
        }
    }
}

// Cleanup expired entries every 5 minutes
setInterval(() => {
    GlobalMemory.cleanupExpired();
}, 5 * 60 * 1000);
