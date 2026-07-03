# Push — Bridge admin broadcasts into the game Notification Center (2026-07-03)

**Repo:** nakama
**Branch:** master (direct push)
**Deploy:** CodePipeline `intelliverse-nakama` (us-east-1) → ECR → EKS `aicart/intelliverse-nakama`

## Problem

Admin console broadcasts (Messages → Broadcast) were delivering to the
`satori_messages` storage inbox, but **no client actually reads that inbox**:

- QuizVerse **web** (`Quizverse-web-frontend`) never calls `satori_messages_list` — no UI.
- QuizVerse **Unity** (`intelliverse-x-games-platform-2`, branch `quiz-verse-prod`)
  has a full Notification Center (`Scripts/Notifications/NotificationCenter.cs`)
  but it reads from three channels only:
  1. FCM push (`FCMManager`)
  2. Nakama **realtime socket** notifications
  3. `list_notification_inbox` RPC — merges Nakama **built-in notifications**
     (`nk.notificationsList`) + custom `notification_inbox` storage entries

So broadcasts were "delivered" server-side but invisible to every player.

## Fix

`SatoriMessages.deliverMessage` (`data/modules/src/satori/messages/messages.ts`)
now also fires a Nakama built-in notification via `nk.notificationSend`:

- **subject/title/body** from the message definition
- **code 110** — unmapped in the Unity `NOTIFICATION_CODE_MAP`, so the client
  renders it as `event_type: "system"`
- **persistent: true** — shows in `list_notification_inbox` for offline users
- content carries `messageDefId` + `hasReward` so the client can deep-link to
  the satori message (and its reward claim) later
- Wrapped in try/catch — the satori inbox write remains the source of truth

This covers every path that calls `deliverMessage`: admin immediate sends,
audience sends, and the scheduled-message sweep.

## Player experience after this deploy

- Online players receive the notification over the realtime socket (toast in
  the Unity Notification Center).
- Offline players see it in the in-app Notification Center inbox on next open
  (`list_notification_inbox`).
- Rewards still require the satori message flow (`satori_messages_read`) —
  the notification is a mirror, not a replacement.

## Verification

1. Admin console → Messages → Broadcast → Send Now.
2. `list_notification_inbox` for a sampled user returns the entry with the
   broadcast title/body, `event_type: "system"`.
3. Unity client: Notification Center shows the message.
