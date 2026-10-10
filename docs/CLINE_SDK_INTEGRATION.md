# Future Cline SDK integration — design only

## Status and verified upstream API

The SDK is **not installed or integrated** in Sakhi. No model calls, provider keys,
AI endpoints, or tool execution are required for the foundation. This document
does not implement or authorize P0/P1 work. Authentication, emergency dialer links,
and any future dispatch/journey state machines must work without AI.

Upstream sources checked on **2026-10-10**:

| Source                                                                                                                          | Verified detail                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SDK package on upstream main](https://raw.githubusercontent.com/cline/cline/main/sdk/packages/sdk/package.json)                | Public ESM package `@cline/sdk`, version **`0.0.92`**, Node engine **`>=22`**; alias/re-export surface for `@cline/core`. This is the observed upstream-main version, not a claim about the npm release currently installed.                                              |
| [SDK README](https://github.com/cline/cline/blob/main/sdk/README.md)                                                            | `import { Agent, createTool } from "@cline/sdk"`; `new Agent({ providerId, modelId, tools: [] })`; explicit custom tools.                                                                                                                                                 |
| [Official runnable quickstart source](https://raw.githubusercontent.com/cline/cline/main/apps/examples/quickstart/src/index.ts) | `providerId: "cline"`, `modelId: "anthropic/claude-sonnet-4.6"`, `apiKey: process.env.CLINE_API_KEY`, `maxIterations: 1`.                                                                                                                                                 |
| [Official first-agent documentation](https://docs.cline.bot/sdk/overview)                                                       | Direct Anthropic alternative: `providerId: "anthropic"`, `modelId: "claude-sonnet-4-6"`, `apiKey: process.env.ANTHROPIC_API_KEY`.                                                                                                                                         |
| [Agent reference](https://docs.cline.bot/sdk/reference/agent)                                                                   | Credentials are top-level `apiKey`, `baseUrl`, and `headers` options; `tools` is an explicit array; `abort()` cancels an active run.                                                                                                                                      |
| [Tools documentation](https://docs.cline.bot/sdk/tools)                                                                         | `createTool({ name, description, inputSchema, execute })` supports Zod or JSON Schema. Agent receives its whole tool list through `tools`; the higher-level ClineCore runtime can enable built-in tools and MCP. Unlisted tool policies default to enabled/auto-approved. |

The README quickstart link `https://docs.cline.bot/sdk/quickstart` currently resolves
to the building-an-agent guide. The runnable source linked above was fetched
separately to verify exact provider configuration. Do not mix the Cline-prefixed
model ID with the direct Anthropic provider configuration.

Upstream `main` and live documentation can move independently. Before any future
installation, pin an approved published package version and commit/release
reference, inspect its exported types, review dependencies and licenses, and run
an isolated compatibility/security spike. In particular, the README shows
`result.text`, while the live Agent reference describes `outputText`; application
response mapping must be verified against the pinned package rather than guessed.
No SDK sample in this document has been executed or typechecked against an
installed SDK.

## Starting point: no tools

This is a **future documentation example**, not current application code. It uses
the provider configuration in the official runnable quickstart and adds an
explicit empty tool list. Construct and run an agent only server-side, behind a
separately reviewed feature flag and consent/authentication boundary.

```ts
import { Agent } from "@cline/sdk";

const apiKey = process.env.CLINE_API_KEY;
if (!apiKey) throw new Error("The optional assistant is not configured.");

const agent = new Agent({
  providerId: "cline",
  modelId: "anthropic/claude-sonnet-4.6",
  apiKey,
  maxIterations: 1,
  systemPrompt:
    "Explain approved app guidance only. You cannot call, dispatch help, " +
    "monitor a journey, or confirm anyone's safety. Never claim otherwise.",
  tools: [],
});
```

A prompt is not a security boundary. Empty tools, restricted service credentials,
process/network isolation, ownership enforcement, and explicit consent are.
Do not introduce ClineCore built-in tool bundles, workspace discovery, MCP,
plugins, subagents, schedules, shell access, or filesystem-backed session storage
into this app-facing assistant. Selecting the low-level `Agent` does not itself
sandbox the Node.js host: the deployment must also prevent access to app secrets,
the database volume, and internal operational endpoints.

## Proposed read-only application boundary

```text
Explicit consent + authenticated user request
  -> dedicated assistant request service (not a dispatch/journey handler)
  -> bounded low-level Agent with a reviewed exact tool allowlist
  -> read-only application-service adapter
  -> server-authorized, minimized DTOs for this user only
```

The adapter API is a future design, not a service that exists in the foundation.
Initially the allowlist should be empty. The first candidate capability is a
static, curated application-help service; a later ownership-reviewed capability
could expose a non-sensitive account-preferences summary. No arbitrary search,
URL, SQL, file path, user ID, tenant ID, or credential input may be accepted.

The tool pattern below illustrates a **closed, read-only service capability**.
Its service implementation must be supplied by a reviewed server boundary; it
is not direct database access. It deliberately receives no model-supplied
ownership identifier and permits no extra input properties.

```ts
import { createTool } from "@cline/sdk";
import { z } from "zod";

type ApprovedGuidanceService = {
  readAccountHelp(): Promise<{
    title: string;
    text: string;
  }>;
};

export function createAccountHelpTool(service: ApprovedGuidanceService) {
  const output = z
    .object({
      title: z.string().max(120),
      text: z.string().max(2000),
    })
    .strict();

  return createTool({
    name: "read_account_help",
    description: "Read curated account-help guidance. Cannot perform actions.",
    inputSchema: z.object({}).strict(),
    async execute() {
      return output.parse(await service.readAccountHelp());
    },
  });
}
```

Only a reviewed instance of that tool would be passed explicitly in `tools`.
Do not rely on missing `toolPolicies` entries to deny capabilities: upstream
defaults are permissive for tools that have been registered. There must be no
fallback to a broader tool bundle if an adapter fails.

### Non-negotiable restrictions

- **No filesystem, shell, database, or write tools.** No raw SQL, generic HTTP
  client, arbitrary network fetch, app mutations, credentials, workspace reads,
  or permission escalation may be exposed to the model.
- **No safety-operation authority.** The assistant cannot create, send, resend,
  acknowledge, cancel, or resolve an SOS; dispatch notifications; initiate a
  call; create/update/cancel journeys; change deadlines or check-ins; or mark
  someone safe. Future dispatch and journey logic must not import or await the
  assistant or depend on model output.
- **No sensitive-data shortcut.** Phone numbers, contact identities, precise
  location, live routes, emergency messages, session tokens, and authentication
  secrets are excluded from prompts and tool output. Account data, if ever
  approved, must be minimized and scoped server-side to the verified session.
- **Authorization is not model input.** Derive the principal using the normal
  server auth boundary; never trust a user ID supplied by the model, query,
  body, or prompt. Any remote service adapter independently checks the same
  authorization and a short-lived read-only capability. A hidden UI control is
  not an ownership check.
- **Treat returned content and model text as untrusted.** Neither can enable
  tools, override consent, grant credentials, or invoke application actions.
  Render safe text, not executable HTML or automatic action links.

## Consent, isolation, and failure behavior

1. Keep the feature disabled by default. Obtain a specific opt-in before any
   prompt or permitted context is sent to a named external model provider.
   Explain data categories, purpose, retention, cost, limitations, and how to
   withdraw consent. Normal app access cannot depend on opting in.
2. Bind consent and each run to the authenticated user. Check consent on every
   request and permitted service call; revoke/cancel outstanding work when it
   is withdrawn. Never share agent histories or caches between users.
3. Run the model integration in an isolated server process/service with no
   app database mount or dispatch credentials. Permit egress only to the
   selected provider and the exact read-only adapter endpoints. Provider keys
   must not use `NEXT_PUBLIC_` variables or enter browser bundles.
4. Bound request size, output size, iterations, wall-clock deadline, concurrency,
   and per-user spend/rate limits in application code. Support cancellation
   via `abort()`, reject over-budget requests, and avoid unbounded retries.
5. On absent credentials, denied consent, timeout, outage, malformed output,
   or denied tool calls, return an ordinary optional-assistant-unavailable
   state. Do not queue safety actions or synthesize a success/dispatch result.
   The emergency `tel:` link remains visible and usable without the assistant.
6. Log only minimal operational metadata and redacted errors. Do not log raw
   prompts, contacts, locations, credentials, or tool DTOs. Review provider
   retention, tracing defaults, and SDK persistence/telemetry before rollout.

## Acceptance gate for any future implementation

- Verify the pinned SDK API and provider configuration in an isolated spike;
  confirm only the exact allowlisted tools are advertised and executable.
- Prove missing/revoked consent prevents provider and tool calls.
- Prove cross-user access is denied at every read-only service boundary;
  include forged IDs, prompt-injection attempts, and concurrent sessions.
- Prove arbitrary tool names, SQL, file paths, URLs, writes, plugins, MCP,
  shell commands, and dispatch/journey actions cannot execute.
- Test provider timeout, cancellation, quota exhaustion, invalid output,
  unavailable credentials, and partial failures without affecting auth,
  emergency links, dispatch, or journey state machines.
- Inspect client bundles, logs, traces, prompts, and network traffic for secrets
  and disallowed personal data. Verify no shared session memory.
- Record actual test commands and outcomes. Documentation examples and mocked
  SDK tests alone are not evidence that an integration works or is safe.

These are future gates only. No SDK dependency or operational assistant is
introduced by the foundation tests or this document.
