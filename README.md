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
if (flagClient.isEnabled("new-checkout", { key: "user-123" })) {
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
if (flagClient.isEnabled("new-header", { key: user.id, plan: user.plan })) {
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
if (flagClient.isEnabled("new-algorithm", { key: req.user.id, plan: req.user.plan })) {
  // use new algorithm
}
```

---

## Segment Targeting

Segments let you enable a flag only for entities that match specific attributes — for example, users on the `"pro"` plan, companies above a certain size, or devices on a specific platform.

### The context object

Every `isEnabled` call accepts a `context` — a flat key-value object describing the entity being evaluated. The `key` field is required and identifies the entity. Everything else is an attribute used for segment matching.

```typescript
// User context
flagClient.isEnabled("new-dashboard", {
  key: "user-123",
  plan: "pro",
  country: "US",
  betaOptIn: true,
});

// Company context (multi-tenant)
flagClient.isEnabled("enterprise-feature", {
  key: "acme-corp",
  plan: "enterprise",
  company_size: 500,
});

// Device context
flagClient.isEnabled("new-onboarding", {
  key: "device-abc123",
  platform: "ios",
  app_version: "2.1.0",
});
```

`key` can be any stable string — a user ID, company slug, device ID, session ID, etc. It is used to identify the entity in analytics and is hashed before storage.

### How evaluation works

A flag has a prioritised list of segments. Each segment has a rollout percentage and a set of conditions that define who belongs to it. When you call `isEnabled`:

- **All conditions within a segment must match** (AND logic) — e.g. `email ends_with "@gmail.com"` AND `country equals "US"`
- **Segments are evaluated in priority order** — the first segment whose conditions match wins
- **Rollout percentage controls what fraction of matched entities see the flag** — bucketing is deterministic, so the same entity always gets the same result

| Step | Condition                                      | Result                            |
| ---- | ---------------------------------------------- | --------------------------------- |
| 1    | Flag not found                                 | `defaultValue` (default: `false`) |
| 2    | Flag is disabled                               | `false`                           |
| 3    | Flag has no segments                           | `true` (global on/off flag)       |
| 4    | Segments defined, no context passed            | `false`                           |
| 5    | Context passed, no segment matches             | `false`                           |
| 6    | Segment matches, entity outside rollout        | `false`                           |
| 7    | Segment matches, entity inside rollout         | `true`                            |

> **Note:** If a flag has segments but you don't pass a context, it always returns `false`. Always pass a context when evaluating targeted flags.

### Segment conditions

Each condition compares a context attribute to a value using one of:

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

## Analytics

The SDK automatically records flag evaluations and flushes them to Flaggy.io in the background. No configuration is required.

- Evaluations are batched and sent every **5 seconds**, or immediately when **100 events** accumulate
- Each unique combination of flag, entity (`key`), and result is recorded **once per session** — re-renders and repeated calls do not produce duplicate events
- In the browser, any buffered events are flushed when the page unloads via `navigator.sendBeacon`
- Analytics never block flag evaluation and errors are swallowed silently

Each event has the following shape:

```json
{
  "flag_key": "new-feature",
  "result": true,
  "segment_matched": "gmail-users-only",
  "context_key": "user-123"
}
```

`segment_matched` is the key of the segment that produced the result, or `"no_match"` if no segment matched. `context_key` is the `key` from your context, hashed before storage.

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

`context` is a flat object of attributes used for segment targeting. The `key` field is required when passing a context and must be a stable identifier for the entity being evaluated (user ID, company slug, device ID, etc.).

```typescript
client.isEnabled("flag-name", { key: "user-123", plan: "pro" });
client.isEnabled("flag-name", { key: "user-123", plan: "pro" }, false);
```

### `client.getAllFlags(): Record<string, FeatureFlag>`

Returns a shallow copy of all currently cached flags.

---

## Features

- ✅ Simple on/off flags and segment targeting
- ✅ Priority-ordered targeting rules with rollout percentage
- ✅ Sticky bucketing — same entity always gets the same result (MurmurHash3)
- ✅ Automatic analytics batching with per-session deduplication
- ✅ Auto-environment detection (localStorage in browser, in-memory on Node.js)
- ✅ Automatic background refresh with exponential backoff
- ✅ Request deduplication — no concurrent duplicate fetches
- ✅ Full TypeScript types
- ✅ Prototype-pollution-safe response handling
- ✅ Structural validation of all API responses

## License

MIT © Flaggy.io
