namespace WalletHelpers {

  export interface GameWallet {
    userId: string;
    gameId: string;
    currencies: { game: number; tokens: number; xp: number; [key: string]: number };
    items: { [key: string]: number };
  }

  export function getGameWallet(nk: nkruntime.Nakama, userId: string, gameId: string): GameWallet {
    var key = "wallet_" + userId + "_" + gameId;
    var wallet = Storage.readJson<GameWallet>(nk, Constants.WALLETS_COLLECTION, key, userId);
    if (!wallet) {
      return {
        userId: userId,
        gameId: gameId,
        currencies: { game: 0, tokens: 0, xp: 0 },
        items: {}
      };
    }
    if (wallet.currencies) {
      if (wallet.currencies.game === undefined) wallet.currencies.game = wallet.currencies.tokens || 0;
      if (wallet.currencies.tokens === undefined) wallet.currencies.tokens = wallet.currencies.game || 0;
    }
    return wallet;
  }

  export function saveGameWallet(nk: nkruntime.Nakama, wallet: GameWallet): void {
    var key = "wallet_" + wallet.userId + "_" + wallet.gameId;
    Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, wallet.userId, wallet, 1, 1);
  }

  export function addCurrency(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, currencyId: string, amount: number): GameWallet {
    var wallet = getGameWallet(nk, userId, gameId);
    if (!wallet.currencies[currencyId]) {
      wallet.currencies[currencyId] = 0;
    }
    wallet.currencies[currencyId] += amount;
    saveGameWallet(nk, wallet);

    EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_EARNED, {
      userId: userId, gameId: gameId, currencyId: currencyId, amount: amount, newBalance: wallet.currencies[currencyId]
    });

    return wallet;
  }

  export function spendCurrency(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, currencyId: string, amount: number): GameWallet {
    var wallet = getGameWallet(nk, userId, gameId);
    var balance = wallet.currencies[currencyId] || 0;
    if (balance < amount) {
      throw new Error("Insufficient " + currencyId + ": have " + balance + ", need " + amount);
    }
    wallet.currencies[currencyId] = balance - amount;
    saveGameWallet(nk, wallet);

    EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_SPENT, {
      userId: userId, gameId: gameId, currencyId: currencyId, amount: amount, newBalance: wallet.currencies[currencyId]
    });

    return wallet;
  }

  export function hasCurrency(nk: nkruntime.Nakama, userId: string, gameId: string, currencyId: string, amount: number): boolean {
    var wallet = getGameWallet(nk, userId, gameId);
    return (wallet.currencies[currencyId] || 0) >= amount;
  }
}
