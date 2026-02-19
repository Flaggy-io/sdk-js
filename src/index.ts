export interface FeatureFlag {
  key: string;
  enabled_production: boolean;
  enabled_staging: boolean;
  enabled_development: boolean;
}

export interface FeatureFlagConfig {
  apiKey: string;
  environment?: "production" | "staging" | "development" | string;
  onError?: (error: Error) => void;
}

// Storage adapter interface for custom implementations
export interface StorageAdapter {
  get(key: string): CachedData | null;
  set(key: string, value: CachedData): void;
  clear(key: string): void;
}

// Storage adapter interface
interface CachedData {
  flags: FeatureFlag[];
  timestamp: number;
}

// LocalStorage adapter for browser
class LocalStorageAdapter implements StorageAdapter {
  get(key: string): CachedData | null {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    try {
      const data = window.localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Error reading from localStorage:", error);
      return null;
    }
  }

  set(key: string, value: CachedData): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error("Error writing to localStorage:", error);
    }
  }

  clear(key: string): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.error("Error clearing localStorage:", error);
    }
  }
}

// In-memory adapter for server-side
class InMemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, CachedData> = new Map();

  get(key: string): CachedData | null {
    return this.store.get(key) || null;
  }

  set(key: string, value: CachedData): void {
    this.store.set(key, value);
  }

  clear(key: string): void {
    this.store.delete(key);
  }
}

class FeatureFlagClient {
  private config: FeatureFlagConfig;
  private storage: StorageAdapter;
  private flags: FeatureFlag[] = [];
  private lastFetch: number = 0;
  private isFetching: boolean = false;
  private fetchPromise: Promise<void> | null = null;
  private environment: "production" | "staging" | "development";
  private failureCount: number = 0;
  private readonly baseRefreshMs: number = 60000;
  private readonly maxRefreshMs: number = 15 * 60 * 1000;

  constructor(config: FeatureFlagConfig) {
    // Validate API key
    if (!config.apiKey || typeof config.apiKey !== "string") {
      throw new Error("API key is required and must be a non-empty string");
    }

    if (config.apiKey.trim().length === 0) {
      throw new Error("API key cannot be empty or whitespace");
    }

    this.config = config;
    this.environment =
      config.environment === "production" ||
      config.environment === "staging" ||
      config.environment === "development"
        ? config.environment
        : "production";

    // Auto-detect environment and use appropriate storage
    this.storage = this.detectEnvironment()
      ? new LocalStorageAdapter()
      : new InMemoryStorageAdapter();

    // Load cached flags on initialization
    this.loadFromCache();

    // Auto-fetch flags in background (fire and forget)
    this.fetchFlags();
  }

  private detectEnvironment(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    );
  }

  private loadFromCache(): void {
    const cached = this.storage.get("feature-flags");
    if (cached && this.isValidCachedData(cached)) {
      this.flags = cached.flags;
      this.lastFetch = cached.timestamp || 0;
    }
  }

  private isValidCachedData(data: any): data is CachedData {
    return (
      data &&
      typeof data === "object" &&
      Array.isArray(data.flags) &&
      data.flags.every(this.isValidFeatureFlag) &&
      typeof data.timestamp === "number"
    );
  }

  private isValidFeatureFlag(flag: any): flag is FeatureFlag {
    return (
      flag &&
      typeof flag === "object" &&
      typeof flag.key === "string" &&
      typeof flag.enabled_production === "boolean" &&
      typeof flag.enabled_staging === "boolean" &&
      typeof flag.enabled_development === "boolean"
    );
  }

  private saveToCache(): void {
    this.storage.set("feature-flags", {
      flags: this.flags,
      timestamp: this.lastFetch,
    });
  }

  // Check if valid flags exist in cache
  private hasCachedFlags(): boolean {
    const cached = this.storage.get("feature-flags");
    return cached ? this.isValidCachedData(cached) : false;
  }

  // Check if cache interval has elapsed and a fetch is needed
  private shouldFetch(): boolean {
    const now = Date.now();
    return now - this.lastFetch > this.getRefreshIntervalMs();
  }

  // Exponential backoff: base * 2^failureCount (capped)
  getRefreshIntervalMs(): number {
    const backoffMs = this.baseRefreshMs * Math.pow(2, this.failureCount);
    return Math.min(backoffMs, this.maxRefreshMs);
  }

  async fetchFlags(): Promise<void> {
    if (!this.shouldFetch()) {
      return;
    }

    // If already fetching, return the existing promise
    if (this.isFetching && this.fetchPromise) {
      return this.fetchPromise;
    }

    this.isFetching = true;
    this.fetchPromise = this.doFetch();

    try {
      await this.fetchPromise;
    } finally {
      this.isFetching = false;
      this.fetchPromise = null;
    }
  }

  private async doFetch(): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(
        "https://api.flaggy.io/public/feature-flags",
        {
          method: "GET",
          headers: {
            "x-api-key": this.config.apiKey,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch feature flags: ${response.status} ${response.statusText}`,
        );
      }

      const json = await response.json();

      // Validate response structure
      if (!json || typeof json !== "object") {
        throw new Error("Invalid API response: expected JSON object");
      }

      if (!json.data) {
        throw new Error("Invalid API response: missing data property");
      }

      const data = json.data;

      // Validate and filter feature flags
      if (!Array.isArray(data)) {
        throw new Error("Invalid API response: data must be an array");
      }

      // Filter out invalid flags and keep only valid ones
      this.flags = data.filter(this.isValidFeatureFlag);

      if (data.length > 0 && this.flags.length === 0) {
        console.warn(
          "All feature flags in API response were invalid and filtered out",
        );
      }

      this.lastFetch = Date.now();
      this.failureCount = 0;
      this.saveToCache();
    } catch (error) {
      this.failureCount += 1;
      const err = error as Error;
      if (this.config.onError) {
        this.config.onError(err);
      }
      if (err.name === "AbortError") {
        console.warn("Feature flag fetch timed out");
        return;
      }
      console.error("Error fetching feature flags:", err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  initialize(): Promise<void> {
    if (this.hasCachedFlags()) {
      return Promise.resolve();
    }

    if (!this.shouldFetch()) {
      return Promise.resolve();
    }

    const timeoutMs = 2000;
    return Promise.race([
      this.fetchFlags(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  isEnabled(flagName: string, defaultValue: boolean = false): boolean {
    // Auto-refresh if needed
    if (this.shouldFetch() && !this.isFetching) {
      this.fetchFlags(); // Fire and forget
    }

    const flag = this.flags.find((f) => f.key === flagName);
    if (!flag) {
      return defaultValue; // Return provided default for unknown flags
    }

    // Check the environment-specific enabled field
    switch (this.environment) {
      case "production":
        return flag.enabled_production;
      case "staging":
        return flag.enabled_staging;
      case "development":
        return flag.enabled_development;
      default:
        return defaultValue;
    }
  }

  getFlag(flagName: string): FeatureFlag | undefined {
    // Auto-refresh if needed
    if (this.shouldFetch() && !this.isFetching) {
      this.fetchFlags(); // Fire and forget
    }

    return this.flags.find((f) => f.key === flagName);
  }

  getAllFlags(): FeatureFlag[] {
    return [...this.flags];
  }

  clearCache(): void {
    this.storage.clear("feature-flags");
    this.flags = [];
  }

  // Set custom storage adapter (useful for testing or custom implementations)
  setStorageAdapter(adapter: StorageAdapter): void {
    this.storage = adapter;
    this.loadFromCache();
  }
}

let globalClient: FeatureFlagClient | null = null;

export function flaggy(config: FeatureFlagConfig): FeatureFlagClient {
  if (globalClient) return globalClient;

  globalClient = new FeatureFlagClient(config);
  return globalClient;
}
