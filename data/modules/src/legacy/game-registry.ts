namespace LegacyGameRegistry {

  interface GameEntry {
    id: string;
    title: string;
    description?: string;
    category?: string;
    status?: string;
    iconUrl?: string;
    bannerUrl?: string;
    minPlayers?: number;
    maxPlayers?: number;
    slug?: string;
    source?: string;
    createdAt?: string;
    updatedAt?: string;
  }

  interface GameRegistryData {
    games: GameEntry[];
    lastSyncAt?: string;
  }

  var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  function getGameRegistry(nk: nkruntime.Nakama): GameRegistryData {
    var data = Storage.readSystemJson<GameRegistryData>(nk, Constants.GAME_REGISTRY_COLLECTION, "registry");
    return data || { games: [] };
  }

  // ── Canonical game-id resolution ───────────────────────────────────────────
  // A single app is reachable by several identifiers — its registry UUID, its
  // human slug ("quizverse"), or the platform aliases ("all"/"global"). Config
  // (flags, experiments, audiences, …) is keyed by the raw string via
  // Constants.gameKey, so the SAME app could otherwise read/write two different
  // stores depending on which id a caller passed. resolveCanonicalGameId folds
  // every alias of a registered app down to ONE canonical scope so all surfaces
  // (admin console, game client, RPCs) agree.
  //
  // Canonical scope = the app's `slug` when set, else its `id`. We prefer the
  // slug because that's where the existing explicit app config already lives
  // (e.g. "quizverse:flags") — so no data migration is needed.
  //
  // Platform-wide aliases ("", "all", "global", "default") → undefined, which
  // Constants.gameKey maps to the bare (platform-default) key, preserving the
  // legacy fallback behaviour exactly.
  var REGISTRY_CACHE: { data: GameRegistryData | null; at: number } = { data: null, at: 0 };
  var REGISTRY_TTL_MS = 30000;

  function cachedRegistry(nk: nkruntime.Nakama): GameRegistryData {
    var now = Date.now();
    if (REGISTRY_CACHE.data && (now - REGISTRY_CACHE.at) < REGISTRY_TTL_MS) {
      return REGISTRY_CACHE.data;
    }
    var data = getGameRegistry(nk);
    REGISTRY_CACHE = { data: data, at: now };
    return data;
  }

  export function resolveCanonicalGameId(nk: nkruntime.Nakama, raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    var v = String(raw).trim().toLowerCase();
    if (v === "" || v === "all" || v === "global" || v === Constants.DEFAULT_GAME_ID) {
      return undefined;
    }
    var games = cachedRegistry(nk).games || [];
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      var gid = (g.id || "").toLowerCase();
      var gslug = (g.slug || "").toLowerCase();
      if (gid === v || (gslug && gslug === v)) {
        return g.slug ? g.slug : g.id;
      }
    }
    // Unregistered identifier — pass through unchanged so behaviour is never a
    // surprise for ids the registry doesn't know about yet.
    return raw;
  }

  function rpcGetGameRegistry(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var registry = getGameRegistry(nk);
    return RpcHelpers.successResponse({ games: registry.games, lastSyncAt: registry.lastSyncAt });
  }

  function rpcGetGameById(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.gameId) return RpcHelpers.errorResponse("gameId required");

    var registry = getGameRegistry(nk);
    var game = registry.games.find(function (g) { return g.id === data.gameId; });
    if (!game) return RpcHelpers.errorResponse("Game not found: " + data.gameId);

    return RpcHelpers.successResponse({ game: game });
  }

  function rpcSyncGameRegistry(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var apiUrl = data.apiUrl || "https://api.intelliversex.com/games";

      var response: any;
      try {
        response = HttpClient.get(nk, apiUrl);
      } catch (err: any) {
        logger.warn("[GameRegistry] API fetch failed, using existing data: " + err.message);
        var existing = getGameRegistry(nk);
        return RpcHelpers.successResponse({ success: true, gamesSync: existing.games.length, source: "cache" });
      }

      var games: GameEntry[] = [];
      if (response && response.code === 200 && response.body) {
        try {
          var parsed = JSON.parse(response.body);
          games = parsed.games || parsed.data || parsed || [];
        } catch (_) {
          games = [];
        }
      }

      var registry: GameRegistryData = {
        games: games,
        lastSyncAt: new Date().toISOString()
      };
      Storage.writeSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry", registry);

      return RpcHelpers.successResponse({ success: true, gamesSync: games.length });
    } catch (err: any) {
      return RpcHelpers.errorResponse("Sync failed: " + err.message);
    }
  }

  // register_game — Admin-only manual app/game registration.
  // Payload: { title, id?, slug?, category?, description?, iconUrl? }
  //   - If `id` is omitted, a fresh UUID is minted and returned as the AppID.
  //   - If `id` is provided it must be a valid UUID (it becomes the gameId
  //     apps send in analytics_log_event). Re-registering an existing id
  //     updates that entry in place (upsert).
  // The returned `id` is the canonical AppID used everywhere for analytics
  // filtering — hand it to the app team to stamp on their events.
  function rpcRegisterGame(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    var title = (typeof data.title === "string" ? data.title : "").trim();
    if (!title) return RpcHelpers.errorResponse("title required");

    var id = (typeof data.id === "string" ? data.id : "").trim();
    if (id) {
      if (!UUID_RE.test(id)) return RpcHelpers.errorResponse("id must be a valid UUID");
      id = id.toLowerCase();
    } else {
      id = nk.uuidv4();
    }

    var slug = (typeof data.slug === "string" ? data.slug : "").trim().toLowerCase();
    if (slug && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
      return RpcHelpers.errorResponse("slug must be lowercase alphanumeric (dashes/underscores allowed, max 64 chars)");
    }

    var nowIso = new Date().toISOString();
    var registry = getGameRegistry(nk);
    var games = registry.games || [];

    var existingIdx = -1;
    for (var i = 0; i < games.length; i++) {
      if (games[i].id === id) { existingIdx = i; break; }
      if (slug && games[i].slug === slug) {
        return RpcHelpers.errorResponse("slug already in use by app " + games[i].id);
      }
    }

    var entry: GameEntry;
    if (existingIdx >= 0) {
      entry = games[existingIdx];
      entry.title = title;
      if (slug) entry.slug = slug;
      if (typeof data.category === "string") entry.category = data.category;
      if (typeof data.description === "string") entry.description = data.description;
      if (typeof data.iconUrl === "string") entry.iconUrl = data.iconUrl;
      entry.updatedAt = nowIso;
    } else {
      entry = {
        id: id,
        title: title,
        slug: slug || undefined,
        category: typeof data.category === "string" ? data.category : undefined,
        description: typeof data.description === "string" ? data.description : undefined,
        iconUrl: typeof data.iconUrl === "string" ? data.iconUrl : undefined,
        status: "active",
        source: "manual",
        createdAt: nowIso,
        updatedAt: nowIso
      };
      games.push(entry);
    }

    Storage.writeSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry", {
      games: games,
      lastSyncAt: registry.lastSyncAt
    });

    return RpcHelpers.successResponse({ game: entry, created: existingIdx < 0 });
  }

  // delete_game — Admin-only. Removes an app from the registry catalog.
  // Note: this only forgets the display metadata; historical analytics keyed
  // on the UUID are untouched.
  function rpcDeleteGame(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var id = (typeof data.id === "string" ? data.id : "").trim().toLowerCase();
    if (!id) return RpcHelpers.errorResponse("id required");

    var registry = getGameRegistry(nk);
    var games = registry.games || [];
    var kept: GameEntry[] = [];
    var removed = 0;
    for (var i = 0; i < games.length; i++) {
      if (games[i].id === id) { removed++; continue; }
      kept.push(games[i]);
    }

    if (removed === 0) return RpcHelpers.errorResponse("App not found: " + id);

    Storage.writeSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry", {
      games: kept,
      lastSyncAt: registry.lastSyncAt
    });

    return RpcHelpers.successResponse({ success: true, removed: removed });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("get_game_registry", rpcGetGameRegistry);
    initializer.registerRpc("get_game_by_id", rpcGetGameById);
    initializer.registerRpc("sync_game_registry", rpcSyncGameRegistry);
    initializer.registerRpc("register_game", rpcRegisterGame);
    initializer.registerRpc("delete_game", rpcDeleteGame);
  }
}
