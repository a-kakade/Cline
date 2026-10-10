# Notification dispatch: implemented boundary, no live SMS integration

No SMS credentials were supplied. **This repository does not currently send SMS.** `NOTIFICATION_PROVIDER=simulation` produces a persisted `simulated` result only outside production; it does not print phone numbers, messages or coordinates. All production configurations currently use a disabled adapter returning `failed / PROVIDER_NOT_CONFIGURED`. Unknown/misspelled configuration never falls back to simulation.

`NotificationProvider.send({to,message,idempotencyKey,signal})` is the one future integration boundary. A real provider must honor bounded cancellation where possible, map documented errors accurately and distinguish `accepted` from delivery evidence. Add only one provider when credentials are available. Confirm Indian SMS sender/template/DLT requirements with that provider. No real-provider credentials or invented environment variable names are included at this stage.

## Meaning of states

- `created`: emergency event and recipient intent are persisted; dispatch has not started.
- `queued` / `sending`: pending/in-flight work; no receipt is claimed.
- `simulated`: local test only. **No message sent.**
- `accepted`: a provider accepted a request, not recipient delivery/read confirmation.
- `delivered`: reserved for provider-confirmed delivery; no installed adapter emits this.
- `failed`: definite failure (including unavailable provider or removed/disabled contact).
- `unknown`: timeout, unexpected response, thrown transport error or interrupted in-flight worker. Could have been accepted; automatic retry is prohibited.
- `partial`: recipient attempts have different final outcomes. Inspect each delivery; not an overall success claim.

There is no acknowledgement API/label because no actual recipient acknowledgement is implemented. A completed database insert is never labelled a successful send.

## Reliability

1. Authenticated user explicitly activates SOS with a UUID and consent. A transaction snapshots enabled contact IDs, inserts the unique `(owner,idempotency_key)` event and one delivery row per contact. Same-key replay returns the existing event, before quota checks. Limit10 new SOS/minute/owner; call112 is never rate limited.
2. Location is optional and may be attached only during the initial dispatch transition. Browser failure does not block persistence. Server validates ranges, accuracy and capture time (past5minutes, future30seconds).
3. Delivery rows are claimed transactionally. Attempts are persisted **before** awaiting provider calls. Sends have a5-second bound. Duplicate/concurrent dispatch calls cannot claim the same row twice.
4. Definite `failed` outcomes retry only when an adapter explicitly guarantees retryable failure. Up to3 attempts, at least60seconds apart, same provider idempotency key. Ambiguous outcomes are never retried automatically. There is no user button that blindly resends an unknown attempt.
5. The protected job recovers created events after15seconds if browser dispatch was interrupted. In-flight work older than30seconds becomes unknown, never resent. Oldest actionable work is selected, not a page of terminal failures. A crash after provider acceptance but before storage remains unknown: exactly-once external delivery is not claimed.
6. Recipients are rechecked for ownership and enabled state before sending. Deleting/disabling a contact prevents unclaimed future attempts. A request already handed to a provider cannot be recalled.

Only a sender display name, emergency message and optionally last-known timestamp/accuracy/maps coordinate link are shared. No public app journey/account URL is created. Provider attempts store structured code/status, not message bodies or recipient phone snapshots. No ordinary logs contain them.

## Jobs

`POST /api/internal/jobs` requires `Authorization: Bearer <JOB_SECRET>`, compared in constant time; no browser receives this secret. With dev app open, use `npm run jobs:once` or `npm run jobs:watch` in another terminal. The watch runner remains active every30seconds and avoids overlapping its own requests. Production must configure an independent runner at least once/minute, retries and failure/lag monitoring. **No production scheduler has been configured or tested.**

The same job clears stored alert coordinates after24hours, deletes terminal alert+delivery history after30days and minimal audit events after90days. Without the runner these are not automatically enforced. Backup/provider retention is separate. Do not send real emergencies during tests.

## Before live delivery

Implement one documented SMS adapter using server-only credentials, provider timeout/error fixtures, signed receipt verification if supported, provider IDs/reconciliation, delivery-evidence tests and staging-number opt-in tests. Verify DLT requirements, disabled/missing credentials, latency, retries and unknown outcomes. Test on explicitly consenting test recipients, never arbitrary trusted-contact numbers. Only then expose a real configured-provider label.
