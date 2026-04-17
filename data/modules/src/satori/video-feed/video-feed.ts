namespace SatoriVideoFeed {

  interface VideoEntry {
    id: string;
    title: string;
    description: string;
    videoUrl: string;           // youtube/tiktok/direct url
    thumbnailUrl: string;
    platform: string;           // "youtube" | "tiktok" | "instagram" | "x" | "facebook" | "direct"
    category: string;           // "name" | "place" | "animal" | "thing" | "promo" | "recap" | "general"
    region: string;             // "india" | "usa" | "global"
    series: string;             // "quiz_shorts" | "event_promo" | "event_recap" | "custom"
    eventId?: string;           // associated creator event if any
    deepLinkUrl?: string;       // in-app deep link
    seriesPart?: number;        // 1, 2, or 3 for 3-part mystery series
    mysteryId?: string;         // groups 3-part series together
    publishedAt: number;        // unix seconds
    expiresAt?: number;         // feed hide time; 0 = never
    priority: number;           // higher = shown first
    views: number;
    clicks: number;
    metadata?: { [key: string]: any };
  }

  interface VideoFeedIndex {
    videoIds: string[];
  }

  var COLLECTION = "satori_video_feed";
  var INDEX_KEY = "videos_index";
  var MAX_FEED_SIZE = 200;

  function getIndex(nk: nkruntime.Nakama): VideoFeedIndex {
    return Storage.readSystemJson<VideoFeedIndex>(nk, COLLECTION, INDEX_KEY) || { videoIds: [] };
  }

  function saveIndex(nk: nkruntime.Nakama, index: VideoFeedIndex): void {
    Storage.writeSystemJson(nk, COLLECTION, INDEX_KEY, index);
  }

  function getVideo(nk: nkruntime.Nakama, videoId: string): VideoEntry | null {
    return Storage.readSystemJson<VideoEntry>(nk, COLLECTION, videoId);
  }

  function saveVideo(nk: nkruntime.Nakama, video: VideoEntry): void {
    Storage.writeSystemJson(nk, COLLECTION, video.id, video);
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    var filterRegion = data.region ? String(data.region) : "";
    var filterSeries = data.series ? String(data.series) : "";
    var filterCategory = data.category ? String(data.category) : "";
    var filterEventId = data.eventId ? String(data.eventId) : "";
    var limit = typeof data.limit === "number" ? Math.min(100, Math.max(1, data.limit)) : 20;

    var index = getIndex(nk);
    var now = Math.floor(Date.now() / 1000);
    var results: VideoEntry[] = [];

    for (var i = 0; i < index.videoIds.length; i++) {
      var v = getVideo(nk, index.videoIds[i]);
      if (!v) continue;
      if (v.expiresAt && v.expiresAt > 0 && v.expiresAt < now) continue;
      if (filterRegion && v.region !== filterRegion && v.region !== "global") continue;
      if (filterSeries && v.series !== filterSeries) continue;
      if (filterCategory && v.category !== filterCategory) continue;
      if (filterEventId && v.eventId !== filterEventId) continue;
      results.push(v);
    }

    results.sort(function (a, b) {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.publishedAt - a.publishedAt;
    });

    if (results.length > limit) results = results.slice(0, limit);

    return RpcHelpers.successResponse({ videos: results, total: results.length });
  }

  function rpcAdd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    if (!data.videoUrl) return RpcHelpers.errorResponse("videoUrl required");
    if (!data.title) return RpcHelpers.errorResponse("title required");

    var id = data.id ? String(data.id) : nk.uuidv4();
    var video: VideoEntry = {
      id: id,
      title: String(data.title),
      description: String(data.description || ""),
      videoUrl: String(data.videoUrl),
      thumbnailUrl: String(data.thumbnailUrl || ""),
      platform: String(data.platform || "youtube"),
      category: String(data.category || "general"),
      region: String(data.region || "global"),
      series: String(data.series || "custom"),
      eventId: data.eventId ? String(data.eventId) : undefined,
      deepLinkUrl: data.deepLinkUrl ? String(data.deepLinkUrl) : undefined,
      seriesPart: typeof data.seriesPart === "number" ? data.seriesPart : undefined,
      mysteryId: data.mysteryId ? String(data.mysteryId) : undefined,
      publishedAt: typeof data.publishedAt === "number" ? data.publishedAt : Math.floor(Date.now() / 1000),
      expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : 0,
      priority: typeof data.priority === "number" ? data.priority : 0,
      views: typeof data.views === "number" ? data.views : 0,
      clicks: typeof data.clicks === "number" ? data.clicks : 0,
      metadata: data.metadata || undefined,
    };

    saveVideo(nk, video);

    var index = getIndex(nk);
    var existingIdx = index.videoIds.indexOf(id);
    if (existingIdx < 0) {
      index.videoIds.push(id);
    }

    // Prune old entries beyond MAX_FEED_SIZE
    if (index.videoIds.length > MAX_FEED_SIZE) {
      var all: VideoEntry[] = [];
      for (var j = 0; j < index.videoIds.length; j++) {
        var vv = getVideo(nk, index.videoIds[j]);
        if (vv) all.push(vv);
      }
      all.sort(function (a, b) { return b.publishedAt - a.publishedAt; });
      var keep = all.slice(0, MAX_FEED_SIZE);
      var keepIds: string[] = [];
      for (var k = 0; k < keep.length; k++) keepIds.push(keep[k].id);
      index.videoIds = keepIds;
    }

    saveIndex(nk, index);
    logger.info("[VideoFeed] Added video %s (%s/%s)", id, video.series, video.category);

    return RpcHelpers.successResponse({ success: true, videoId: id });
  }

  function rpcRemove(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.videoId) return RpcHelpers.errorResponse("videoId required");

    var id = String(data.videoId);
    var index = getIndex(nk);
    var idx = index.videoIds.indexOf(id);
    if (idx >= 0) {
      index.videoIds.splice(idx, 1);
      saveIndex(nk, index);
    }
    try {
      nk.storageDelete([{ collection: COLLECTION, key: id, userId: Constants.SYSTEM_USER_ID }]);
    } catch (err: any) {
      logger.warn("[VideoFeed] Failed to delete video %s: %s", id, err.message || String(err));
    }
    return RpcHelpers.successResponse({ success: true, videoId: id });
  }

  function rpcTrackClick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.videoId) return RpcHelpers.errorResponse("videoId required");

    var v = getVideo(nk, String(data.videoId));
    if (!v) return RpcHelpers.errorResponse("Video not found");

    var field = data.field === "view" ? "view" : "click";
    if (field === "view") v.views = (v.views || 0) + 1;
    else v.clicks = (v.clicks || 0) + 1;
    saveVideo(nk, v);

    return RpcHelpers.successResponse({ success: true, videoId: v.id, views: v.views, clicks: v.clicks });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("video_feed_list", rpcList);
    initializer.registerRpc("video_feed_add", rpcAdd);
    initializer.registerRpc("video_feed_remove", rpcRemove);
    initializer.registerRpc("video_feed_track", rpcTrackClick);
  }
}
