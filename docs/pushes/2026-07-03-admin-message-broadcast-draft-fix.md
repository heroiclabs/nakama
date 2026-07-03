# Push — Admin message broadcast stuck in "draft" (2026-07-03)

**Repo:** nakama
**Branch:** master (direct push)
**Deploy:** CodePipeline `intelliverse-nakama` (us-east-1) → ECR → EKS `aicart/intelliverse-nakama`

## Problem

From the admin console (**Messages → Broadcast**), creating a message with
**"All players (no filter)"** and clicking **Send Now** saved the message with
`status: "draft"` and delivered it to nobody. The UI confirmed "Message sent!"
but the message only ever appeared in the list as a draft.

## Root cause

`admin_satori_message_broadcast` (`data/modules/src/hiro/base/admin.ts`,
`rpcAdminMessageBroadcast`) only executed the delivery path when an
`audience_id` was provided:

```ts
status: scheduleAt && scheduleAt > now ? "scheduled" : "draft",
...
if (audienceId && (!scheduleAt || scheduleAt <= now)) {
  delivered = SatoriMessages.deliverToAudience(...);
  messageDef.status = "delivered";
}
```

With no audience selected, the guard never fired, so the record kept its
initial `"draft"` status. Two secondary issues:

- Audience sends were stored with `status: "delivered"`, a value the admin UI
  doesn't recognize (`statusColors` / filter modes only know
  `draft | scheduled | sent | failed`), so even successful sends rendered with
  the draft badge and didn't match the **sent** filter.
- `SatoriMessages.processScheduledMessages` had the same gap: a *scheduled*
  message with no audience was marked `sent` at its schedule time without
  delivering to anyone.

## Fix

| File | Change |
|---|---|
| `data/modules/src/hiro/base/admin.ts` (`rpcAdminMessageBroadcast`) | "Send Now" with no audience now delivers to a random sample of up to 100 users (same approach as `satori_messages_broadcast`) and records `status: "sent"`, `deliveredCount`, `sentAt`. Audience sends also record `sent` instead of `delivered`. |
| `data/modules/src/hiro/base/admin.ts` (`rpcAdminMessagesList`) | Legacy records stored as `"delivered"` are normalized to `"sent"` when listed. |
| `data/modules/src/satori/messages/messages.ts` (`processScheduledMessages`) | Scheduled messages with no audience filter now deliver to the same random-sample of users instead of being silently marked sent. |
| `data/modules/index.js`, `data/modules/build/index.js` | Regenerated bundle (1170 RPCs). |

## Notes

- Existing draft messages are **not** retroactively sent — re-send them from
  the Broadcast form after this deploy.
- "All players" delivery is a sample of up to 100 random users (Nakama has no
  cheap all-users iterator in the JS runtime); true full-population broadcast
  would need a paginated sweep job.

## Verification

1. Admin console → Messages → Broadcast → title only, no audience, no
   schedule → **Send Now**.
2. Message appears in the list with the **sent** badge and a delivered count.
3. A sampled player calling `satori_messages_list` sees the message in their
   inbox.
