export type WorkersAI = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  toMarkdown(files: { name: string; blob: Blob }[]): Promise<{ data?: string; format?: string }[]>;
};

export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

// The subset of Cloudflare D1 the app uses. On Node it is backed by node:sqlite (./sqlite.ts).
export type DbResult<T = Record<string, unknown>> = { results: T[]; meta: { changes: number } };
export type DbStatement = {
  bind(...values: unknown[]): DbStatement;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<DbResult>;
};
// A batch runs as one transaction, and writes from different requests never interleave inside it.
export type Db = { prepare(sql: string): DbStatement; batch(statements: DbStatement[]): Promise<DbResult[]> };

export type Platform = { ai?: WorkersAI; limiter?: RateLimiter; writeLimiter?: RateLimiter; db: Db };
