# Flaggy.io Feature Flag SDK

A JavaScript / TypeScript SDK for managing feature flags from Flaggy.io that is fully compatible for both client-side (browser) and server-side (Node.js) environments.

## Features

- ✅ **Safe defaults**: Optional default values for graceful handling of new users and network failures
- ✅ **Auto-environment detection**: Uses localStorage in browsers, in-memory storage in Node.js
- ✅ **Automatic caching**: Reduces API calls and improves performance
- ✅ **Auto-refresh**: Refreshes on a 60-second base interval with exponential backoff on failures
- ✅ **Request deduplication**: Prevents concurrent duplicate API requests
- ✅ **TypeScript support**: Full type safety
- ✅ **Environment-based flags**: Support for production, staging, and development environments
- ✅ **Simple configuration**: Only requires an API key
- ✅ **Input validation**: Validates API keys and response data

## Requirements

- **Node.js**: 18.0.0 or higher (required for native `fetch()` API support)
- **Browser**: Any modern browser with ES2020 support

## Installation

```bash
npm install @flaggy.io/sdk-js
```

## Client-Side (React)

Create a dedicated file (e.g., `src/lib/flaggy.ts`):

```typescript
import { flaggy } from "@flaggy.io/sdk-js";

export const flagClient = flaggy({
  apiKey: import.meta.env.VITE_FLAGGY_API_KEY!,
  environment: import.meta.env.VITE_ENVIRONMENT,
});

// Export a wrapper function for cleaner usage throughout your app
export function featureEnabled(
  flagName: string,
  defaultValue?: boolean,
): boolean {
  return flagClient.isEnabled(flagName, defaultValue);
}
```

Initialize and wait for flags:

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { flagClient } from "./lib/flaggy";

await flagClient.initialize();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Simple usage example:

```tsx
import { featureEnabled } from "./lib/flaggy";

export function Header() {
  // Specify safe default for new users (before flags load)
  return featureEnabled("new-header", false) ? <NewHeader /> : <OldHeader />;
}
```

## Server-Side (Node.js)

Create a dedicated client file (e.g., `src/lib/flaggy.ts`):

```typescript
import { flaggy } from "@flaggy.io/sdk-js";

export const flagClient = flaggy({
  apiKey: process.env.FLAGGY_API_KEY!,
  environment: process.env.NODE_ENV,
});

// Export a wrapper function for cleaner usage
export function featureEnabled(
  flagName: string,
  defaultValue?: boolean,
): boolean {
  return flagClient.isEnabled(flagName, defaultValue);
}
```

Then in your server startup file (e.g., `src/server.ts` or `src/index.ts`), **await the initial flag load before starting your server**:

```typescript
import { featureEnabled, flagClient } from "./lib/flaggy";
import express, { Application, Request, Response } from "express";

const app: Application = express();
const port = process.env.PORT || 3000;

app.get("/", (req: Request, res: Response) => {
  if (featureEnabled("new-service")) {
    // Logic for the new service
  } else {
    // Logic for the old service
  }
});

async function start(): Promise<void> {
  await flagClient.initialize();

  app.listen(port, () => {
    console.log(`Server is Fire at http://localhost:${port}`);
  });
}

void start();
```

Use throughout your application:

```typescript
import { featureEnabled } from "./lib/flaggy";

if (featureEnabled("new-algorithm", true)) {
  // Defaulting to enabled
}
```

To react to fetch errors without throwing, provide an `onError` callback:

```typescript
const flagClient = flaggy({
  apiKey: import.meta.env.VITE_FLAGGY_API_KEY!,
  onError: (error) => {
    console.warn("Flag fetch failed:", error);
  },
});
```

**Environment:** The `environment` field is optional and defaults to `"production"`. You can pass raw strings (for example `process.env.NODE_ENV` / `import.meta.env.VITE_ENVIRONMENT`), and the SDK will only use `"production"`, `"staging"`, or `"development"`—any other value falls back to `"production"`.

```typescript
// Omit entirely (uses "production")
const flagClient = flaggy({
  apiKey: import.meta.env.VITE_FLAGGY_API_KEY!,
});

// Or pass env directly (SDK normalizes invalid values to "production")
environment: import.meta.env.VITE_ENVIRONMENT,
```

**Network Errors:** The SDK logs fetch errors to the console and invokes the `onError` callback if provided. If the API is unreachable, the SDK will continue to use cached flags and retry on the next refresh interval using exponential backoff (base 60 seconds, capped at 15 minutes).

**Timeout:** Requests are aborted after 2 seconds to avoid long stalls.

## API Reference

### Configuration

The SDK uses the following hard-coded values:

- **API URL**: `https://api.flaggy.io/public/feature-flags`
- **Storage Key**: `feature-flags`
- **Refresh Interval**: 60-second base with exponential backoff on failures (capped at 15 minutes)
- **Authentication**: `x-api-key` header

### Feature Flag Structure

Each feature flag has the following structure:

```typescript
interface FeatureFlag {
  key: string;
  enabled_production: boolean;
  enabled_staging: boolean;
  enabled_development: boolean;
}
```

This allows the same flag to have different states across different environments.

### `flaggy(config: FeatureFlagConfig): FeatureFlagClient`

Initialize the global feature flag client with your API key and environment.

**Factory-only:** `FeatureFlagClient` is not exported, so clients must be created via `flaggy()`.

**Singleton Behavior:** Multiple calls to `flaggy()` return the same instance. This makes it safe to call in React components that re-render, and prevents duplicate API requests and race conditions.

**Auto-initialization:** Flags are automatically fetched in the background when you instantiate the client via `flaggy()`. The client loads from cache immediately if available and auto-refreshes on a 60-second base interval with exponential backoff on failures.

**React / Client-Side:** Call `await client.initialize()` before rendering your app. If cached flags exist in localStorage, `initialize()` returns immediately without blocking—preventing flash screens on page refresh. If no cache exists, it waits up to 2 seconds for the initial fetch.

**Node.js / Server Startup:** Call `await client.initialize()` before starting your server. Since the in-memory cache is empty on server restart, `initialize()` will wait up to 2 seconds for the initial fetch to ensure flags are available before accepting requests.

**Config Options:**

- `apiKey` (required): Your Flaggy.io API key for authentication
- `environment` (optional): Accepts any string input (e.g. `process.env.NODE_ENV`), but only `'production'`, `'staging'`, and `'development'` are used; all other values default to `'production'`.
- `onError` (optional): Callback invoked when a flag fetch fails. Does not throw.

**Returns:** `FeatureFlagClient` instance

**Important:** Configuration is locked after the first call. Subsequent calls with different config values will return the existing instance with the original configuration.

## Client API (returned by `flaggy()`)

**Caching behavior:**

- **Client-side (React/browser):** Flags are loaded from localStorage immediately on instantiation. If cache is stale (> 60 seconds), a background fetch updates the flags without blocking.
- **Server-side (Node.js):** In-memory cache is empty on server restart, so `initialize()` should be awaited to ensure flags are loaded before serving requests.
- All flag evaluations (`isEnabled()`, `getFlag()`) trigger automatic background refreshes when the cache interval expires.

### `isEnabled(flagName: string, defaultValue?: boolean): boolean`

Check if a feature flag is enabled for the configured environment.

**Parameters:**

- `flagName`: The key of the feature flag to check
- `defaultValue`: Optional default value to return if flag doesn't exist or isn't loaded yet (defaults to `false`)

**Returns:** `boolean` - Whether the flag is enabled

**Example:**

```typescript
// Safe default for new users (flag not loaded yet)
if (flagClient.isEnabled("new-ui", false)) {
  // Show new UI only if flag exists and is enabled
}

// Default to enabled for opt-out features
if (flagClient.isEnabled("analytics", true)) {
  // Analytics enabled unless explicitly disabled
}
```

**Best Practice:** Always specify a safe default value that provides the correct experience for new users before flags load, or during network failures.

### `getFlag(flagName: string): FeatureFlag | undefined`

Get the full feature flag object with all environment states.

### `getAllFlags(): FeatureFlag[]`

Get all cached feature flags.

### `initialize(): Promise<void>`

Initialize the feature flag client. **This is the recommended method to call during application startup.**

**Behavior:**

- **If cached flags exist** (React/browser with localStorage): Returns immediately without fetching or blocking
- **If no cache exists** (Node.js server startup or first-time browser load): Waits up to 2 seconds for the initial fetch, then resolves even if the request hasn't finished

```typescript
// React: instant return if cache exists, prevents flash screen
await flagClient.initialize();

// Node.js: waits for initial fetch since cache is always empty on restart
await flagClient.initialize();
```

**Use cases:**

- React/browser: Prevents blocking on page refresh when flags are cached
- Node.js: Ensures flags are loaded before accepting requests

### `async fetchFlags(): Promise<void>`

Manually fetch flags from the API. Use this for manual refreshes after the initial setup.

**Rate Limiting:** Respects the refresh interval. Multiple calls within the interval will return immediately without fetching. The interval uses a 60-second base and exponential backoff on failures (capped at 15 minutes).

**Use cases:**

- Manual refresh outside the automatic 60-second interval
- Testing scenarios where you need deterministic flag state

**Note:** `fetchFlags()` always respects the refresh interval. There is no force-refresh API; after calling `clearCache()`, the SDK will refresh on the next interval or when `initialize()` decides a fetch is needed.

### `clearCache(): void`

Clear all cached flags.

### `getRefreshIntervalMs(): number`

Returns the current refresh interval in milliseconds. The SDK uses a 60-second base interval and applies exponential backoff on failures, capped at 15 minutes.

## API Response Format

The Flaggy.io API returns feature flags in the following format:

```json
{
  "data": [
    {
      "key": "dark-mode",
      "enabled_production": true,
      "enabled_staging": true,
      "enabled_development": true
    },
    {
      "key": "new-feature",
      "enabled_production": false,
      "enabled_staging": true,
      "enabled_development": true
    }
  ]
}
```

The SDK automatically:

- Validates the API response structure
- Filters out invalid flags
- Checks the appropriate `enabled_*` field based on your configured environment
- Sends your API key in the `x-api-key` header

## License

MIT © Flaggy.io
