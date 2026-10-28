export type WorkersAI = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
  toMarkdown(files: { name: string; blob: Blob }[]): Promise<{ data?: string; format?: string }[]>;
};

export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export type Platform = { ai?: WorkersAI; limiter?: RateLimiter };
