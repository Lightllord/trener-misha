# Manual context truncation for the Realtime session — implementation plan

## Context

We configured OpenAI's built-in `truncation.retention_ratio` (see `backend/src/realtime/consts/session.ts` — `TRUNCATION_CONFIG`) to cap how much conversation history gets resent to the model each turn, since insights injected by `gameEventQueue.ts` accumulate for the whole match otherwise.

The server confirms it stored the config (`session.updated confirmed truncation: {...}` — since removed from logging once verified), but in a live test the conversation grew past the configured `post_instructions` limit (20 000 tokens) by 7 000+ tokens with zero `conversation.item.deleted` events. OpenAI's own docs and community threads suggest this mechanism may only exclude old items from a given Response's input rather than deleting them from stored history — so there is no reliable client-side signal that it's doing anything, and no way to verify it actually bounds cost short of comparing real OpenAI billing across long matches.

If billing data eventually shows the built-in truncation isn't bounding cost, implement this instead: an explicit, verifiable deletion of our own injected messages.

## Approach

Track every item this backend itself injects into the conversation (`SessionConductor.injectMessage`, used for delivered insights) and delete the oldest ones ourselves once some threshold is crossed, via `conversation.item.delete`. Unlike the built-in mechanism, this is fully observable — deletions we issue ourselves will emit `conversation.item.deleted`, already logged in `sessionLog.ts`.

## Steps

1. **Capture item ids on injection** — `conversation.item.create` client events can carry a client-generated `item.id`. Generate one (`crypto.randomUUID()`) in `SessionConductor.injectMessage` and keep a FIFO queue of `{ id, insertedAt }` on the instance.
2. **Eviction policy** — pick one:
   - Count-based: keep the last N injected items (e.g. N=20), delete the oldest once the queue exceeds N.
   - Age-based: delete items older than T minutes (e.g. 10) — closer to "this insight is stale, stop paying to resend it."
   - Start with count-based — simpler, no timers to manage.
3. **Send deletion** — `session.transport.sendEvent({ type: "conversation.item.delete", item_id })` for each evicted id.
4. **Only manage our own injected items** — never touch user speech or assistant replies; those are the actual conversation, unlike our injected system-role insights which are one-shot nudges.
5. **Verify** — the existing `item_deleted` log line in `backend/src/observability/sessionLog.ts` already fires correctly for real deletions; use it to confirm in real time once this ships.
6. **Decide on `TRUNCATION_CONFIG`** — keep it alongside as a backstop for turns/audio content that manual deletion doesn't touch, or drop it if it proves to add nothing once billing data comes in.

## Where to change

- `backend/src/realtime/sessionConductor.ts` — add the FIFO tracking + eviction call inside `injectMessage`.
- `backend/src/realtime/consts/session.ts` — add the eviction threshold constant next to `TRUNCATION_CONFIG`.

## Open questions before implementing

- Does deleting a `system`-role item the model already used to justify part of its last spoken reply cause any user-visible glitch (e.g. the model referencing something no longer in its context)? Likely negligible for one-shot coaching nudges, but worth a sanity check in a real session.
- Confirm `conversation.item.delete` accepts the client-supplied ids we set on `conversation.item.create` (should — OpenAI's client-event docs describe `item.id` as client-settable).
