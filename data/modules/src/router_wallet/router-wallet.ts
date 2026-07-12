/**
 * RouterWallet — app-id credit wallets for Intelliverse Router.
 *
 * Replicates the QuizVerse coins pattern (storage-object wallets) but keyed
 * by APP ID instead of user id: collection "router_wallets", key
 * `wallet_{appId}`, owned by the SYSTEM user since apps are not Nakama users.
 *
 * Drop-in module for nakama-multiplayer-kernel: copy this folder to
 * data/modules/src/router_wallet/ and call RouterWallet.register(initializer)
 * from main.ts InitModule. Self-contained on purpose — no references to the
 * kernel's shared namespaces (Storage/RpcHelpers/Constants).
 *
 * All RPCs are SERVER-TO-SERVER ONLY (http_key auth): any call with a
 * ctx.userId is rejected.
 *
 * Concurrency: optimistic concurrency control via the storage object version
 * — every write passes the version read ("*" for create) and retries up to
 * 3 times on conflict.
 */
namespace RouterWallet {

  export var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
  export var WALLETS_COLLECTION = "router_wallets";
  export var LEDGER_COLLECTION = "router_wallet_ledger";
  // Ref index for credit idempotency: one object per (appId, ref), created
  // conditionally ("*") so replays and races can never double-credit.
  export var CREDIT_REFS_COLLECTION = "router_wallet_credit_refs";
  export var MAX_OCC_RETRIES = 3;

  export var CREDIT_KINDS = [
    // Unified currency (docs/business/credit-system.md): every SKU — LLM,
    // image, video, voice, music, 3D — is priced in iv_credits.
    "iv_credits",
    // Legacy per-kind currencies: still valid during the migration window;
    // frozen and removed after the one-time balance conversion (§9).
    "img_credits",
    "vid_credits",
    "voice_credits",
    "audio_credits",
    "book_credits",
    "gen3d_credits"
  ];

  export interface WalletHold {
    kind: string;
    amount: number;
    createdAt: string;
  }

  export interface WalletValue {
    appId: string;
    workspaceId: string;
    currencies: { [kind: string]: number };
    holds: { [holdId: string]: WalletHold };
    version: number; // logical revision counter (OCC uses the storage version)
  }

  export interface LedgerEntry {
    appId: string;
    kind: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    ref: string | null;
    holdId?: string;
    createdAt: string;
  }

  // ---- helpers ----

  function ok(data: any): string {
    return JSON.stringify({ success: true, data: data });
  }

  function err(message: string): string {
    return JSON.stringify({ success: false, error: message });
  }

  function parsePayload(payload: string): any {
    if (!payload || payload === "") return {};
    return JSON.parse(payload);
  }

  /** All router_wallet RPCs are server-to-server only (http_key auth). */
  function requireServerToServer(ctx: nkruntime.Context): void {
    if (ctx.userId) {
      throw new Error("router_wallet RPCs are server-to-server only");
    }
  }

  function validateKind(kind: string): void {
    if (CREDIT_KINDS.indexOf(kind) === -1) {
      throw new Error("Unknown credit kind: " + kind + " (expected one of " + CREDIT_KINDS.join(", ") + ")");
    }
  }

  function validateAmount(amount: any, allowZero?: boolean): number {
    var n = Number(amount);
    if (!isFinite(n) || n < 0 || (!allowZero && n === 0)) {
      throw new Error("amount must be a " + (allowZero ? "non-negative" : "positive") + " number");
    }
    return n;
  }

  function emptyWallet(appId: string, workspaceId: string): WalletValue {
    var currencies: { [kind: string]: number } = {};
    for (var i = 0; i < CREDIT_KINDS.length; i++) currencies[CREDIT_KINDS[i]] = 0;
    return { appId: appId, workspaceId: workspaceId || "", currencies: currencies, holds: {}, version: 0 };
  }

  function heldAmount(wallet: WalletValue, kind: string): number {
    var total = 0;
    for (var holdId in wallet.holds) {
      var hold = wallet.holds[holdId];
      if (hold && hold.kind === kind) total += hold.amount;
    }
    return total;
  }

  export function availableBalance(wallet: WalletValue, kind: string): number {
    return (wallet.currencies[kind] || 0) - heldAmount(wallet, kind);
  }

  function walletKey(appId: string): string {
    return "wallet_" + appId;
  }

  function readWallet(nk: nkruntime.Nakama, appId: string): { wallet: WalletValue | null; storageVersion: string } {
    var records = nk.storageRead([{ collection: WALLETS_COLLECTION, key: walletKey(appId), userId: SYSTEM_USER_ID }]);
    if (records && records.length > 0 && records[0].value) {
      return { wallet: records[0].value as WalletValue, storageVersion: records[0].version };
    }
    return { wallet: null, storageVersion: "*" }; // "*" = conditional create (must not exist)
  }

  function writeWallet(nk: nkruntime.Nakama, wallet: WalletValue, storageVersion: string): void {
    wallet.version = (wallet.version || 0) + 1;
    nk.storageWrite([{
      collection: WALLETS_COLLECTION,
      key: walletKey(wallet.appId),
      userId: SYSTEM_USER_ID,
      value: wallet as any,
      version: storageVersion,
      permissionRead: 0 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);
  }

  /**
   * Read-mutate-write with OCC. The mutator runs against a fresh read on each
   * attempt; business errors thrown by the mutator abort immediately (no
   * retry), while storage version conflicts retry up to MAX_OCC_RETRIES.
   */
  function mutateWallet(
    nk: nkruntime.Nakama,
    appId: string,
    createIfMissing: boolean,
    workspaceId: string,
    mutator: (wallet: WalletValue) => void
  ): WalletValue {
    var lastError: any = null;
    for (var attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
      var read = readWallet(nk, appId);
      var wallet = read.wallet;
      if (!wallet) {
        if (!createIfMissing) throw new Error("Wallet not found for app " + appId);
        wallet = emptyWallet(appId, workspaceId);
      }
      mutator(wallet); // business validation happens here — throws are fatal
      try {
        writeWallet(nk, wallet, read.storageVersion);
        return wallet;
      } catch (e: any) {
        lastError = e; // version conflict — re-read and retry
      }
    }
    throw new Error("Wallet write conflict after " + MAX_OCC_RETRIES + " retries: " + (lastError && lastError.message ? lastError.message : String(lastError)));
  }

  function creditRefKey(appId: string, ref: string): string {
    return "ref_" + appId + "_" + ref;
  }

  /**
   * Claim a credit ref via conditional create ("*"). Returns true when this
   * call owns the ref; false when a credit with the same (appId, ref) already
   * went through (replayed webhook, retried grant job, double-fired cron).
   */
  function claimCreditRef(nk: nkruntime.Nakama, appId: string, ref: string, meta: any): boolean {
    try {
      nk.storageWrite([{
        collection: CREDIT_REFS_COLLECTION,
        key: creditRefKey(appId, ref),
        userId: SYSTEM_USER_ID,
        value: meta,
        version: "*",
        permissionRead: 0 as nkruntime.ReadPermissionValues,
        permissionWrite: 0 as nkruntime.WritePermissionValues
      }]);
      return true;
    } catch (e) {
      return false; // conditional create failed: ref already claimed
    }
  }

  function releaseCreditRef(nk: nkruntime.Nakama, appId: string, ref: string): void {
    try {
      nk.storageDelete([{ collection: CREDIT_REFS_COLLECTION, key: creditRefKey(appId, ref), userId: SYSTEM_USER_ID }]);
    } catch (e) {
      // best-effort rollback; a stuck marker only blocks re-crediting this ref
    }
  }

  function ledgerKey(appId: string): string {
    var random = Math.floor(Math.random() * 0xffffff).toString(16);
    return "txn_" + appId + "_" + Date.now() + "_" + random;
  }

  function writeLedger(nk: nkruntime.Nakama, entry: LedgerEntry): string {
    var key = ledgerKey(entry.appId);
    nk.storageWrite([{
      collection: LEDGER_COLLECTION,
      key: key,
      userId: SYSTEM_USER_ID,
      value: entry as any,
      permissionRead: 0 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);
    return key;
  }

  function walletView(wallet: WalletValue) {
    var available: { [kind: string]: number } = {};
    for (var i = 0; i < CREDIT_KINDS.length; i++) {
      available[CREDIT_KINDS[i]] = availableBalance(wallet, CREDIT_KINDS[i]);
    }
    return {
      appId: wallet.appId,
      workspaceId: wallet.workspaceId,
      currencies: wallet.currencies,
      holds: wallet.holds,
      available: available,
      version: wallet.version
    };
  }

  // ---- RPC handlers ----

  export function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      var read = readWallet(nk, data.appId);
      var wallet = read.wallet || emptyWallet(data.appId, "");
      return ok(walletView(wallet));
    } catch (e: any) {
      return err(e.message || "router_wallet_get failed");
    }
  }

  export function rpcCredit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.reason) return err("reason required");
      validateKind(data.kind);
      var amount = validateAmount(data.amount);

      // Ref-based idempotency (launch blocker fix): a ref (Stripe invoice id,
      // trickle_<user>_<date>, ...) credits at most once per app. The ref is
      // claimed BEFORE the wallet mutation so a concurrent replay loses the
      // conditional create and returns the already-applied wallet instead.
      var ref: string | null = data.ref || null;
      if (ref) {
        var claimed = claimCreditRef(nk, data.appId, ref, {
          appId: data.appId,
          kind: data.kind,
          amount: amount,
          reason: data.reason,
          createdAt: new Date().toISOString()
        });
        if (!claimed) {
          var existing = readWallet(nk, data.appId);
          var view = walletView(existing.wallet || emptyWallet(data.appId, data.workspaceId || ""));
          return ok({ appId: view.appId, workspaceId: view.workspaceId, currencies: view.currencies, holds: view.holds, available: view.available, version: view.version, deduped: true });
        }
      }

      var wallet: WalletValue;
      try {
        wallet = mutateWallet(nk, data.appId, true, data.workspaceId || "", function (w) {
          if (data.workspaceId && !w.workspaceId) w.workspaceId = data.workspaceId;
          w.currencies[data.kind] = (w.currencies[data.kind] || 0) + amount;
        });
      } catch (mutateError: any) {
        // Credit never applied — release the ref so a retry can succeed.
        if (ref) releaseCreditRef(nk, data.appId, ref);
        throw mutateError;
      }

      writeLedger(nk, {
        appId: data.appId,
        kind: data.kind,
        delta: amount,
        balanceAfter: wallet.currencies[data.kind],
        reason: data.reason,
        ref: ref,
        createdAt: new Date().toISOString()
      });

      return ok(walletView(wallet));
    } catch (e: any) {
      return err(e.message || "router_wallet_credit failed");
    }
  }

  export function rpcDebit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.reason) return err("reason required");
      validateKind(data.kind);
      var amount = validateAmount(data.amount);

      var wallet = mutateWallet(nk, data.appId, false, "", function (w) {
        var available = availableBalance(w, data.kind);
        if (available < amount) {
          throw new Error("Insufficient " + data.kind + ": available " + available + ", need " + amount);
        }
        w.currencies[data.kind] = (w.currencies[data.kind] || 0) - amount;
      });

      writeLedger(nk, {
        appId: data.appId,
        kind: data.kind,
        delta: -amount,
        balanceAfter: wallet.currencies[data.kind],
        reason: data.reason,
        ref: data.ref || null,
        createdAt: new Date().toISOString()
      });

      return ok(walletView(wallet));
    } catch (e: any) {
      return err(e.message || "router_wallet_debit failed");
    }
  }

  export function rpcHold(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.ref) return err("ref required");
      validateKind(data.kind);
      var amount = validateAmount(data.amount);

      var holdId = nk.uuidv4();
      var wallet = mutateWallet(nk, data.appId, false, "", function (w) {
        var available = availableBalance(w, data.kind);
        if (available < amount) {
          throw new Error("Insufficient " + data.kind + " for hold: available " + available + ", need " + amount);
        }
        w.holds[holdId] = { kind: data.kind, amount: amount, createdAt: new Date().toISOString() };
      });

      return ok({ holdId: holdId, wallet: walletView(wallet) });
    } catch (e: any) {
      return err(e.message || "router_wallet_hold failed");
    }
  }

  export function rpcSettle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      if (!data.holdId) return err("holdId required");
      var actualAmount = validateAmount(data.actualAmount, true); // 0 = full release

      var settledKind = "";
      var heldAmt = 0;
      var wallet = mutateWallet(nk, data.appId, false, "", function (w) {
        var hold = w.holds[data.holdId];
        if (!hold) throw new Error("Hold not found: " + data.holdId);
        if (actualAmount > hold.amount) {
          throw new Error("actualAmount " + actualAmount + " exceeds held amount " + hold.amount);
        }
        settledKind = hold.kind;
        heldAmt = hold.amount;
        delete w.holds[data.holdId];
        w.currencies[hold.kind] = (w.currencies[hold.kind] || 0) - actualAmount;
      });

      writeLedger(nk, {
        appId: data.appId,
        kind: settledKind,
        delta: -actualAmount,
        balanceAfter: wallet.currencies[settledKind],
        reason: actualAmount === 0 ? "hold_released" : "hold_settled",
        ref: data.ref || null,
        holdId: data.holdId,
        createdAt: new Date().toISOString()
      });

      return ok({
        holdId: data.holdId,
        kind: settledKind,
        heldAmount: heldAmt,
        settledAmount: actualAmount,
        released: heldAmt - actualAmount,
        wallet: walletView(wallet)
      });
    } catch (e: any) {
      return err(e.message || "router_wallet_settle failed");
    }
  }

  export function rpcHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      requireServerToServer(ctx);
      var data = parsePayload(payload);
      if (!data.appId) return err("appId required");
      var limit = data.limit ? Math.min(Number(data.limit), 200) : 50;

      var prefix = "txn_" + data.appId + "_";
      var entries: any[] = [];
      var cursor: string = data.cursor || "";
      // Ledger keys embed the appId; the collection is shared across apps, so
      // filter by key prefix while paging (same pattern as the kernel's
      // legacy wallet registry listing).
      do {
        var result = nk.storageList(SYSTEM_USER_ID, LEDGER_COLLECTION, limit, cursor);
        var objects = (result && result.objects) || [];
        for (var i = 0; i < objects.length; i++) {
          var obj = objects[i];
          if (obj.key && obj.key.indexOf(prefix) === 0 && obj.value) {
            entries.push({ key: obj.key, entry: obj.value });
            if (entries.length >= limit) break;
          }
        }
        cursor = (result && result.cursor) || "";
      } while (cursor && entries.length < limit);

      entries.sort(function (a, b) {
        var ta = (a.entry && a.entry.createdAt) || "";
        var tb = (b.entry && b.entry.createdAt) || "";
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });

      return ok({ appId: data.appId, entries: entries, cursor: cursor || null });
    } catch (e: any) {
      return err(e.message || "router_wallet_history failed");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("router_wallet_get", rpcGet);
    initializer.registerRpc("router_wallet_credit", rpcCredit);
    initializer.registerRpc("router_wallet_debit", rpcDebit);
    initializer.registerRpc("router_wallet_hold", rpcHold);
    initializer.registerRpc("router_wallet_settle", rpcSettle);
    initializer.registerRpc("router_wallet_history", rpcHistory);
  }
}

// Expose the namespace for the standalone vitest harness. Inside Nakama's
// Goja runtime this is a harmless no-op guard (namespaces are already global
// in the kernel's outFile bundle).
if (typeof globalThis !== "undefined") {
  (globalThis as any).RouterWallet = RouterWallet;
}
