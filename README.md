# Flaggy

A JavaScript / TypeScript SDK for managing feature flags and segments from Flaggy.io, fully compatible with both client-side (browser) and server-side (Node.js) environments.

## Requirements

- **Node.js**: 18.0.0 or higher
- **Browser**: Any modern browser with ES2020 support

## Installation

```bash
npm install @flaggy.io/sdk-js
```

## Quick Start

### 1. Create the client

```typescript
import { flaggy } from "@flaggy.io/sdk-js";

export const flagClient = flaggy({
  apiKey: process.env.FLAGGY_API_KEY!,
});
```

### 2. Initialize before use

```typescript
await flagClient.initialize();
```

This ensures flags are loaded before you start evaluating them. If a warm cache exists (browser), it returns immediately. On Node.js it waits for the first fetch to complete.

### 3. Check a flag

```typescript
if (flagClient.isEnabled("new-checkout")) {
  // show new checkout
}
```

That's it for simple on/off flags. Read on for environment configuration, segment targeting, and error handling.

---

## Setup by Environment

### React / Browser

```typescript
// src/lib/flaggy.ts
import { flaggy } from "@flaggy.io/sdk-js";

export const flagClient = flaggy({
  apiKey: import.meta.env.VITE_FLAGGY_API_KEY!,
  environment: import.meta.env.VITE_ENVIRONMENT,
});
```

```tsx
// src/main.tsx — await before rendering to avoid flash of wrong content
await flagClient.initialize();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

```tsx
// usage anywhere in your app
if (flagClient.isEnabled("new-header")) {
  return <NewHeader />;
}
```

### Node.js

```typescript
// src/lib/flaggy.ts
import { flaggy } from "@flaggy.io/sdk-js";

export const flagClient = flaggy({
  apiKey: process.env.FLAGGY_API_KEY!,
  environment: process.env.NODE_ENV,
});
```

```typescript
// src/server.ts — await before accepting requests
await flagClient.initialize();

app.listen(3000);
```

```typescript
// usage in a route handler
if (flagClient.isEnabled("new-algorithm")) {
  // use new algorithm
}
```

---

## Segment Targeting

Segments let you enable a flag only for users who match specific attributes — for example, users on the `"pro"` plan, or users in a beta programme.

### Passing a context

Instead of a simple flag name, pass a flat key-value `context` describing the current user or request:

```typescript
const context = {
  plan: "pro",
  country: "US",
  betaOptIn: true,
};

if (flagClient.isEnabled("new-dashboard", context)) {
  // only shown to users matching an applicable segment
}
```

### How evaluation works

A segment is a set of rules defined in the Flaggy.io dashboard (e.g. `plan equals "pro"`). When you pass a context:

- **All rules in a segment must match** (AND logic within a segment)
- **Any matching segment enables the flag** (OR logic across segments)

| Step | Condition                           | Result                                  |
| ---- | ----------------------------------- | --------------------------------------- |
| 1    | Flag not found                      | `defaultValue` (default: `false`)       |
| 2    | Flag is disabled                    | `false`                                 |
| 3    | Flag has no segments                | `true` (global on/off flag)             |
| 4    | Segments defined, no context passed | `false`                                 |
| 5    | Context passed                      | `true` if any segment's rules all match |

> **Note:** If a flag has segments but you don't pass a context, it always returns `false`. Always pass a context when evaluating segment-targeted flags.

### Rule operators

Each rule compares a context attribute to a value using one of:

| Operator       | Description                                 |
| -------------- | ------------------------------------------- |
| `equals`       | Attribute exactly matches the value         |
| `not_equals`   | Attribute does not match the value          |
| `contains`     | Attribute string contains the value         |
| `not_contains` | Attribute string does not contain the value |
| `starts_with`  | Attribute string starts with the value      |
| `ends_with`    | Attribute string ends with the value        |

All attribute values are coerced to strings before comparison. If the attribute is missing from the context, the rule evaluates to `false`.

---

## Configuration Options

```typescript
const flagClient = flaggy({
  apiKey: "your-api-key", // required
  environment: "production", // optional — "production" | "staging" | "development", defaults to "production"
  onError: (err) => {
    // optional — called on fetch failure, does not throw
    console.warn(err);
  },
});
```

The `environment` field accepts raw strings like `process.env.NODE_ENV`. Any value other than `"production"`, `"staging"`, or `"development"` falls back to `"production"`.

---

## Caching & Refresh

The SDK caches flags locally and refreshes them automatically in the background.

- **Browser:** Cached in `localStorage`. Loaded immediately on startup; stale cache triggers a background refresh without blocking.
- **Node.js:** Cached in-memory per process. Empty on restart, so `initialize()` always fetches before resolving.

The refresh interval starts at **60 seconds** and doubles on each failure, capped at **15 minutes**. Request timeouts (3 seconds) also count as failures — this intentionally backs clients off during API outages to aid recovery.

---

## API Reference

### `flaggy(config): FeatureFlagClient`

Creates (or returns) the global singleton client. Safe to call across modules — subsequent calls return the same instance.

### `client.initialize(): Promise<void>`

Ensures flags are ready. Call once at application startup before evaluating any flags.

### `client.isEnabled(flagName, context?, defaultValue?): boolean`

Evaluates a flag. Returns `defaultValue` (`false` by default) if the flag doesn't exist.

### `client.getAllFlags(): Record<string, FeatureFlag>`

Returns a shallow copy of all currently cached flags.

---

## Features

- ✅ Simple on/off flags and segment targeting
- ✅ Auto-environment detection (localStorage in browser, in-memory on Node.js)
- ✅ Automatic background refresh with exponential backoff
- ✅ Request deduplication — no concurrent duplicate fetches
- ✅ Full TypeScript types
- ✅ Prototype-pollution-safe response handling
- ✅ Structural validation of all API responses

## License

MIT © Flaggy.io
