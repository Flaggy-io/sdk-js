export interface TargetingRule {
  priority: number;
  segment_key: string;
  rollout_percentage: number;
}

export interface FeatureFlag {
  enabled: boolean;
  targeting: TargetingRule[];
}

export type Operator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with";

export interface SegmentRule {
  attribute: string;
  operator: Operator;
  value: string;
}

export type Context = Record<string, string | number | boolean>;

export interface FeatureFlagConfig {
  apiKey: string;
  environment?: "production" | "staging" | "development";
  onError?: (error: Error) => void;
}

interface StorageAdapter {
  get(key: string): CachedData | null;
  set(key: string, value: CachedData): void;
  clear(key: string): void;
}

// Storage adapter interface
interface CachedData {
  flags: Record<string, FeatureFlag>;
  segments: Record<string, SegmentRule[]>;
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
  private flags: Record<string, FeatureFlag> = {};
  private segments: Record<string, SegmentRule[]> = {};
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
    const cached = this.storage.get("flaggy");
    if (cached && this.isValidCachedData(cached)) {
      const flags = Object.create(null) as Record<string, FeatureFlag>;
      for (const [key, value] of Object.entries(cached.flags)) {
        if (this.isValidFlag(value)) {
          flags[key] = value;
        }
      }

      const segments = Object.create(null) as Record<string, SegmentRule[]>;
      for (const [key, value] of Object.entries(cached.segments)) {
        if (Array.isArray(value) && value.every(this.isValidSegmentRule)) {
          segments[key] = value as SegmentRule[];
        }
      }

      this.flags = flags;
      this.segments = segments;
      this.lastFetch = cached.timestamp || 0;
    }
  }

  private isValidCachedData(data: any): data is CachedData {
    if (
      !data ||
      typeof data !== "object" ||
      typeof data.timestamp !== "number"
    ) {
      return false;
    }
    if (
      !data.flags ||
      typeof data.flags !== "object" ||
      Array.isArray(data.flags)
    ) {
      return false;
    }
    if (
      !data.segments ||
      typeof data.segments !== "object" ||
      Array.isArray(data.segments)
    ) {
      return false;
    }
    return (
      Object.values(data.flags).every((f) => this.isValidFlag(f)) &&
      Object.values(data.segments).every(
        (rules) => Array.isArray(rules) && rules.every(this.isValidSegmentRule),
      )
    );
  }

  private isValidTargetingRule(rule: unknown): rule is TargetingRule {
    return (
      rule !== null &&
      typeof rule === "object" &&
      typeof (rule as Record<string, unknown>)["priority"] === "number" &&
      typeof (rule as Record<string, unknown>)["segment_key"] === "string" &&
      typeof (rule as Record<string, unknown>)["rollout_percentage"] === "number" &&
      (rule as Record<string, unknown>)["rollout_percentage"] as number >= 0 &&
      (rule as Record<string, unknown>)["rollout_percentage"] as number <= 100
    );
  }

  private isValidFlag(flag: unknown): flag is FeatureFlag {
    return (
      flag !== null &&
      typeof flag === "object" &&
      typeof (flag as Record<string, unknown>)["enabled"] === "boolean" &&
      Array.isArray((flag as Record<string, unknown>)["targeting"]) &&
      ((flag as Record<string, unknown>)["targeting"] as unknown[]).every(
        this.isValidTargetingRule,
      )
    );
  }

  private isValidSegmentRule(rule: unknown): rule is SegmentRule {
    const validOperators: Operator[] = [
      "equals",
      "not_equals",
      "contains",
      "not_contains",
      "starts_with",
      "ends_with",
    ];
    return (
      rule !== null &&
      typeof rule === "object" &&
      typeof (rule as Record<string, unknown>)["attribute"] === "string" &&
      typeof (rule as Record<string, unknown>)["value"] === "string" &&
      validOperators.includes(
        (rule as Record<string, unknown>)["operator"] as Operator,
      )
    );
  }

  private saveToCache(): void {
    this.storage.set("flaggy", {
      flags: this.flags,
      segments: this.segments,
      timestamp: this.lastFetch,
    });
  }

  private isCacheStale(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age > this.getRefreshIntervalMs();
  }

  private hasCachedFlags(): boolean {
    const cache = this.storage.get("flaggy");

    if (!cache) return false;

    const isValidCache = this.isValidCachedData(cache);

    if (!isValidCache) return false;

    const isCacheStale = this.isCacheStale(cache.timestamp);

    if (isCacheStale) return false;

    return true;
  }

  // Check if cache interval has elapsed and a fetch is needed
  private shouldFetch(): boolean {
    const now = Date.now();
    return now - this.lastFetch > this.getRefreshIntervalMs();
  }

  // Exponential backoff: base * 2^failureCount (capped)
  private getRefreshIntervalMs(): number {
    const backoffMs = this.baseRefreshMs * Math.pow(2, this.failureCount);
    return Math.min(backoffMs, this.maxRefreshMs);
  }

  private async fetchFlags(): Promise<void> {
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
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(
        `https://api.flaggy.io/public/manifest?environment=${this.environment}`,
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

      if (!json || typeof json !== "object") {
        throw new Error("Invalid API response: expected JSON object");
      }

      if (
        !json.flags ||
        typeof json.flags !== "object" ||
        Array.isArray(json.flags)
      ) {
        throw new Error(
          "Invalid API response: missing or invalid flags object",
        );
      }

      if (
        !json.segments ||
        typeof json.segments !== "object" ||
        Array.isArray(json.segments)
      ) {
        throw new Error(
          "Invalid API response: missing or invalid segments object",
        );
      }

      const flags = Object.create(null) as Record<string, FeatureFlag>;
      for (const [key, value] of Object.entries(json.flags)) {
        if (this.isValidFlag(value)) {
          flags[key] = value;
        }
      }

      const segments = Object.create(null) as Record<string, SegmentRule[]>;
      for (const [key, value] of Object.entries(json.segments)) {
        if (Array.isArray(value) && value.every(this.isValidSegmentRule)) {
          segments[key] = value as SegmentRule[];
        }
      }

      this.flags = flags;
      this.segments = segments;
      this.lastFetch = Date.now();
      this.failureCount = 0;
      this.saveToCache();
    } catch (error) {
      this.failureCount += 1;
      this.lastFetch = Date.now();
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

    return this.fetchFlags();
  }

  private evaluateRule(rule: SegmentRule, context: Context): boolean {
    const attribute = context[rule.attribute];

    if (attribute === undefined) return false;

    const actual = attribute.toString();

    switch (rule.operator) {
      case "equals":
        return actual === rule.value;
      case "not_equals":
        return actual !== rule.value;
      case "contains":
        return actual.includes(rule.value);
      case "not_contains":
        return !actual.includes(rule.value);
      case "starts_with":
        return actual.startsWith(rule.value);
      case "ends_with":
        return actual.endsWith(rule.value);
      default:
        return false;
    }
  }

  private matchesSegment(rules: SegmentRule[], context: Context): boolean {
    return rules.every((rule) => this.evaluateRule(rule, context));
  }

  private rolloutBucket(flagName: string, context: Context): number {
    const key =
      flagName +
      ":" +
      Object.entries(context)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(",");

    // MurmurHash3 32-bit (Austin Appleby), using Math.imul for correct 32-bit multiply
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const remainder = key.length & 3;
    const bytes = key.length - remainder;
    let h1 = 0;
    let i = 0;

    while (i < bytes) {
      let k1 =
        (key.charCodeAt(i) & 0xff) |
        ((key.charCodeAt(i + 1) & 0xff) << 8) |
        ((key.charCodeAt(i + 2) & 0xff) << 16) |
        ((key.charCodeAt(i + 3) & 0xff) << 24);
      i += 4;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
    }

    let k1 = 0;
    switch (remainder) {
      case 3: k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16; // falls through
      case 2: k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;  // falls through
      case 1:
        k1 ^= key.charCodeAt(i) & 0xff;
        k1 = Math.imul(k1, c1);
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = Math.imul(k1, c2);
        h1 ^= k1;
    }

    h1 ^= key.length;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return (h1 >>> 0) % 100;
  }

  public isEnabled(
    flagName: string,
    context?: Context,
    defaultValue: boolean = false,
  ): boolean {
    // Auto-refresh if needed
    if (this.shouldFetch() && !this.isFetching) {
      this.fetchFlags(); // Fire and forget
    }

    const flag = this.flags[flagName];

    if (!flag) return defaultValue;

    if (!flag.enabled) return false;
    if (flag.targeting.length === 0) return true;
    if (!context) return false;

    return flag.targeting
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .some(({ segment_key, rollout_percentage }) => {
        const rules = this.segments[segment_key];
        return (
          rules !== undefined &&
          this.matchesSegment(rules, context) &&
          this.rolloutBucket(flagName, context) < rollout_percentage
        );
      });
  }

  public getAllFlags(): Record<string, FeatureFlag> {
    return { ...this.flags };
  }
}

let globalClient: FeatureFlagClient | null = null;

export function flaggy(config: FeatureFlagConfig): FeatureFlagClient {
  if (globalClient) return globalClient;

  globalClient = new FeatureFlagClient(config);
  return globalClient;
}
