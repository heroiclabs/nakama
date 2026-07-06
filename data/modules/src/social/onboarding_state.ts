// onboarding_state.ts — ivx_social_onboarding_state (G-014, doc §E.4).
//
// THE COLD-START PROBLEM
//   A new user's Social Zone is an empty list — the worst first impression a
//   social feature can make. This RPC gives the client a server-authoritative
//   answer to "what should this user see FIRST in the Social Zone?" based on
//   the Cold-Start Ladder (§E.4):
//     Stage 0: 0 friends    → "Find Friends" is the only CTA
//     Stage 1: 1-2 friends  → suggestions strip + celebrate the first friend
//     Stage 2: 3-9 friends  → friend leaderboard, social pressure kicks in
//     Stage 3: 10+ friends  → full social zone
//
// Pure read: one nk.friendsList scan (same cost every friends RPC already
// pays). No writes, no state. The client may cache the response until the
// friend count changes (notification codes 2/5 invalidate).

namespace SocialOnboardingState {

  var STATE_FRIEND          = 0;
  var STATE_INVITE_RECEIVED = 2;

  interface SuggestedAction {
    action:   string;
    priority: number;
    cta:      string;
  }

  function rpcOnboardingState(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);

      var friendCount = 0;
      var pendingReceived = 0;
      try {
        var page = nk.friendsList(userId, 1000, undefined as any, undefined as any);
        if (page && page.friends) {
          for (var i = 0; i < page.friends.length; i++) {
            var f: any = page.friends[i];
            if (!f) continue;
            var s = (f.state && typeof f.state === "object" && "value" in f.state) ? f.state.value : f.state;
            if (s === STATE_FRIEND) friendCount++;
            else if (s === STATE_INVITE_RECEIVED) pendingReceived++;
          }
        }
      } catch (e: any) {
        logger.warn("[SocialOnboarding] friendsList failed: " + (e && e.message));
      }

      var stage = 0;
      if (friendCount >= 10)     stage = 3;
      else if (friendCount >= 3) stage = 2;
      else if (friendCount >= 1) stage = 1;

      // Suggested actions, most important first. Pending incoming invites
      // always outrank everything — accepting one is the cheapest possible
      // path to the next stage.
      var actions: SuggestedAction[] = [];
      if (pendingReceived > 0) {
        actions.push({ action: "review_pending_invites", priority: 1,
                       cta: pendingReceived === 1 ? "You have a friend request waiting!" : ("You have " + pendingReceived + " friend requests waiting!") });
      }
      if (stage === 0) {
        actions.push({ action: "find_friends",    priority: 2, cta: "Find your first friend" });
        actions.push({ action: "join_group",      priority: 3, cta: "Join a group — you don't need friends to start" });
      } else if (stage === 1) {
        actions.push({ action: "send_challenge",  priority: 2, cta: "Challenge a friend to a quiz!" });
        actions.push({ action: "find_friends",    priority: 3, cta: "Find more friends" });
      } else if (stage === 2) {
        actions.push({ action: "view_leaderboard", priority: 2, cta: "See where you rank among friends" });
        actions.push({ action: "send_challenge",   priority: 3, cta: "Challenge a friend to a quiz!" });
      } else {
        actions.push({ action: "create_group",    priority: 2, cta: "Start a group with your friends" });
        actions.push({ action: "send_challenge",  priority: 3, cta: "Challenge a friend to a quiz!" });
      }

      return RpcHelpers.successResponse({
        friendCount:     friendCount,
        pendingReceived: pendingReceived,
        stage:           stage,
        suggestedActions: actions
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to compute onboarding state");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_onboarding_state", rpcOnboardingState);
  }
}
