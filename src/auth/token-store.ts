import { readFile, writeFile, mkdir } from "fs/promises";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { homedir } from "os";
import { join } from "path";

export interface TokenRecord {
  mcpToken: string;
  // Token type: only "access" tokens may be presented on the /mcp bearer path.
  kind: "access" | "refresh";
  notionToken: string;
  refreshToken?: string;
  workspaceId?: string;
  clientId: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number; // timestamp ms
}

const ALGORITHM = "aes-256-gcm";
const DEFAULT_DIR = join(homedir(), ".easy-notion-mcp");

export class TokenStore {
  private key!: Buffer;
  private dir: string;
  private tokensPath: string;
  private keyPath: string;

  constructor(dir?: string) {
    this.dir = dir ?? DEFAULT_DIR;
    this.tokensPath = join(this.dir, "tokens.json");
    this.keyPath = join(this.dir, "server.key");
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      this.key = await readFile(this.keyPath);
      if (this.key.length !== 32) throw new Error("Invalid key length");
    } catch {
      this.key = randomBytes(32);
      await writeFile(this.keyPath, this.key, { mode: 0o600 });
    }
  }

  private encrypt(data: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // iv:tag:ciphertext, all base64
    return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
  }

  private decrypt(blob: string): string {
    const [ivB64, tagB64, dataB64] = blob.split(":");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const encrypted = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  private async load(): Promise<TokenRecord[]> {
    try {
      const blob = await readFile(this.tokensPath, "utf8");
      const json = this.decrypt(blob);
      return JSON.parse(json) as TokenRecord[];
    } catch {
      return [];
    }
  }

  private async save(records: TokenRecord[]): Promise<void> {
    const json = JSON.stringify(records);
    const blob = this.encrypt(json);
    await writeFile(this.tokensPath, blob, { mode: 0o600 });
  }

  async storeToken(record: TokenRecord): Promise<void> {
    const records = await this.load();
    // Replace existing record for same MCP token, or append
    const idx = records.findIndex((r) => r.mcpToken === record.mcpToken);
    if (idx >= 0) {
      records[idx] = record;
    } else {
      records.push(record);
    }
    await this.save(records);
  }

  async getByMcpToken(mcpToken: string): Promise<TokenRecord | undefined> {
    const records = await this.load();
    return records.find((r) => r.mcpToken === mcpToken);
  }

  async getByNotionToken(notionToken: string): Promise<TokenRecord | undefined> {
    const records = await this.load();
    return records.find((r) => r.notionToken === notionToken);
  }

  async deleteToken(mcpToken: string): Promise<void> {
    const records = await this.load();
    const filtered = records.filter((r) => r.mcpToken !== mcpToken);
    await this.save(filtered);
  }

  async deleteByRefreshToken(refreshToken: string): Promise<void> {
    const records = await this.load();
    const filtered = records.filter((r) => r.refreshToken !== refreshToken);
    await this.save(filtered);
  }
}
