namespace RewardEngine {

  export function resolveReward(nk: nkruntime.Nakama, reward: Hiro.Reward): Hiro.ResolvedReward {
    var result: Hiro.ResolvedReward = {
      currencies: {},
      items: {},
      energies: {},
      modifiers: []
    };

    if (reward.guaranteed) {
      mergeGrant(result, reward.guaranteed);
    }

    if (reward.weighted && reward.weighted.length > 0) {
      var rolls = reward.maxRolls || 1;
      for (var r = 0; r < rolls; r++) {
        var picked = pickWeighted(nk, reward.weighted);
        if (picked) {
          mergeGrant(result, picked);
        }
      }
    }

    return result;
  }

  function pickWeighted(nk: nkruntime.Nakama, pool: Hiro.WeightedReward[]): Hiro.WeightedReward | null {
    var totalWeight = 0;
    for (var i = 0; i < pool.length; i++) {
      totalWeight += pool[i].weight;
    }
    if (totalWeight <= 0) return null;

    var randStr = nk.uuidv4();
    var rand = simpleHash(randStr) % totalWeight;
    var cumulative = 0;
    for (var j = 0; j < pool.length; j++) {
      cumulative += pool[j].weight;
      if (rand < cumulative) {
        return pool[j];
      }
    }
    return pool[pool.length - 1];
  }

  function simpleHash(str: string): number {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash = hash & 0x7FFFFFFF;
    }
    return hash;
  }

  function mergeGrant(target: Hiro.ResolvedReward, grant: Hiro.RewardGrant): void {
    if (grant.currencies) {
      for (var cid in grant.currencies) {
        if (!target.currencies[cid]) target.currencies[cid] = 0;
        target.currencies[cid] += grant.currencies[cid];
      }
    }
    if (grant.items) {
      for (var iid in grant.items) {
        var itemDef = grant.items[iid];
        var qty = itemDef.min;
        if (itemDef.max && itemDef.max > itemDef.min) {
          qty = itemDef.min + Math.floor(Math.random() * (itemDef.max - itemDef.min + 1));
        }
        if (!target.items[iid]) target.items[iid] = 0;
        target.items[iid] += qty;
      }
    }
    if (grant.energies) {
      for (var eid in grant.energies) {
        if (!target.energies[eid]) target.energies[eid] = 0;
        target.energies[eid] += grant.energies[eid];
      }
    }
    if (grant.energyModifiers) {
      for (var m = 0; m < grant.energyModifiers.length; m++) {
        target.modifiers.push(grant.energyModifiers[m]);
      }
    }
    if (grant.rewardModifiers) {
      for (var n = 0; n < grant.rewardModifiers.length; n++) {
        target.modifiers.push(grant.rewardModifiers[n]);
      }
    }
  }

  export function grantReward(
    nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context,
    userId: string, gameId: string, resolved: Hiro.ResolvedReward
  ): void {
    // Grant currencies
    for (var cid in resolved.currencies) {
      if (resolved.currencies[cid] > 0) {
        WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, cid, resolved.currencies[cid]);
      }
    }

    // Grant items via inventory system
    for (var iid in resolved.items) {
      if (resolved.items[iid] > 0) {
        HiroInventory.grantItem(nk, logger, ctx, userId, iid, resolved.items[iid], undefined, undefined, gameId);
      }
    }

    // Grant energy
    for (var eid in resolved.energies) {
      if (resolved.energies[eid] > 0) {
        HiroEnergy.addEnergy(nk, logger, ctx, userId, eid, resolved.energies[eid], gameId);
      }
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.REWARD_GRANTED, {
      userId: userId, gameId: gameId, reward: resolved
    });
  }

  export function grantToMailbox(
    nk: nkruntime.Nakama, userId: string,
    subject: string, reward: Hiro.Reward, expiresAt?: number
  ): void {
    var msg: Hiro.MailboxMessage = {
      id: nk.uuidv4(),
      subject: subject,
      reward: reward,
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: expiresAt
    };

    var mailbox = Storage.readJson<Hiro.UserMailbox>(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", userId);
    if (!mailbox) {
      mailbox = { messages: [] };
    }
    mailbox.messages.push(msg);
    Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", userId, mailbox);
  }
}
