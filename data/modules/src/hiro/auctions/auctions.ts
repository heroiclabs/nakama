namespace HiroAuctions {

  var DEFAULT_CONFIG: Hiro.AuctionsConfig = { categories: [], listingFeePct: 5, durationSec: 86400, maxActiveListings: 5 };

  export function getConfig(nk: nkruntime.Nakama): Hiro.AuctionsConfig {
    return ConfigLoader.loadConfig<Hiro.AuctionsConfig>(nk, "auctions", DEFAULT_CONFIG);
  }

  interface AuctionListing {
    id: string;
    sellerId: string;
    itemId: string;
    itemCount: number;
    startingBid: number;
    currentBid: number;
    highestBidderId?: string;
    currencyId: string;
    category: string;
    createdAt: number;
    endsAt: number;
    resolved: boolean;
  }

  function getListing(nk: nkruntime.Nakama, listingId: string): AuctionListing | null {
    return Storage.readSystemJson<AuctionListing>(nk, Constants.HIRO_AUCTIONS_COLLECTION, listingId);
  }

  function saveListing(nk: nkruntime.Nakama, listing: AuctionListing): void {
    Storage.writeSystemJson(nk, Constants.HIRO_AUCTIONS_COLLECTION, listing.id, listing);
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var result = Storage.listUserRecords(nk, Constants.HIRO_AUCTIONS_COLLECTION, Constants.SYSTEM_USER_ID, data.limit || 20, data.cursor);
    var now = Math.floor(Date.now() / 1000);
    var listings = result.records.filter(function (r) {
      var l = r.value as any as AuctionListing;
      return !l.resolved && l.endsAt > now && (!data.category || l.category === data.category);
    }).map(function (r) { return r.value; });

    return RpcHelpers.successResponse({ listings: listings, cursor: result.cursor });
  }

  function rpcCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.itemId || !data.startingBid || !data.currencyId) {
      return RpcHelpers.errorResponse("itemId, startingBid, and currencyId required");
    }

    var config = getConfig(nk);
    var count = data.itemCount || 1;

    if (!HiroInventory.consumeItem(nk, logger, ctx, userId, data.itemId, count, data.gameId)) {
      return RpcHelpers.errorResponse("Insufficient items");
    }

    var now = Math.floor(Date.now() / 1000);
    var listing: AuctionListing = {
      id: nk.uuidv4(),
      sellerId: userId,
      itemId: data.itemId,
      itemCount: count,
      startingBid: data.startingBid,
      currentBid: data.startingBid,
      currencyId: data.currencyId,
      category: data.category || "general",
      createdAt: now,
      endsAt: now + config.durationSec,
      resolved: false
    };

    saveListing(nk, listing);
    return RpcHelpers.successResponse({ listing: listing });
  }

  function rpcBid(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.listingId || !data.amount) return RpcHelpers.errorResponse("listingId and amount required");

    var listing = getListing(nk, data.listingId);
    if (!listing || listing.resolved) return RpcHelpers.errorResponse("Listing not found or resolved");

    var now = Math.floor(Date.now() / 1000);
    if (now > listing.endsAt) return RpcHelpers.errorResponse("Auction ended");
    if (data.amount <= listing.currentBid) return RpcHelpers.errorResponse("Bid must exceed current bid of " + listing.currentBid);

    if (listing.highestBidderId) {
      WalletHelpers.addCurrency(nk, logger, ctx, listing.highestBidderId, data.gameId || "default", listing.currencyId, listing.currentBid);
    }

    WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", listing.currencyId, data.amount);

    listing.currentBid = data.amount;
    listing.highestBidderId = userId;
    saveListing(nk, listing);

    return RpcHelpers.successResponse({ listing: listing });
  }

  function rpcResolve(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.listingId) return RpcHelpers.errorResponse("listingId required");

    var listing = getListing(nk, data.listingId);
    if (!listing || listing.resolved) return RpcHelpers.errorResponse("Listing not found or already resolved");

    var config = getConfig(nk);
    listing.resolved = true;

    if (listing.highestBidderId) {
      HiroInventory.grantItem(nk, logger, ctx, listing.highestBidderId, listing.itemId, listing.itemCount, undefined, undefined, data.gameId);
      var fee = Math.floor(listing.currentBid * config.listingFeePct / 100);
      var sellerProceeds = listing.currentBid - fee;
      WalletHelpers.addCurrency(nk, logger, ctx, listing.sellerId, data.gameId || "default", listing.currencyId, sellerProceeds);
    } else {
      HiroInventory.grantItem(nk, logger, ctx, listing.sellerId, listing.itemId, listing.itemCount, undefined, undefined, data.gameId);
    }

    saveListing(nk, listing);
    return RpcHelpers.successResponse({ listing: listing });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_auctions_list", rpcList);
    initializer.registerRpc("hiro_auctions_create", rpcCreate);
    initializer.registerRpc("hiro_auctions_bid", rpcBid);
    initializer.registerRpc("hiro_auctions_resolve", rpcResolve);
  }
}
