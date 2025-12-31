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

