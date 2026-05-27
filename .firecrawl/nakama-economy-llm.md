\# Creating an Economy

\*\*URL:\*\* https://heroiclabs.com/docs/nakama/guides/concepts/economy/
\*\*Summary:\*\* This guide gives practical guidance on creating an in-game economy using IAPs, the virtual wallet and storage engine.
\*\*Keywords:\*\* creating an economy, nakama
\*\*Categories:\*\* nakama, economy, concepts

\-\-\-

\# Creating an Economy

This guide will demonstrate how you can develop in-game economy systems using Nakama's \[IAP validation\](../../../concepts/iap-validation/), \[virtual wallet\](../../../concepts/user-accounts/#virtual-wallet) and \[storage engine\](../../../concepts/storage/) functionality.

For this guide we will allow players to purchase a premium currency, Gems, via IAPs. These Gems can then be spent in-game to purchase Coins which can in turn be used to purchase in-game items.

We will also allow players to become a Premium player using an IAP and later restore that purchase if necessary.

\## Purchasing premium currency with IAPs

The following server runtime code example assumes the use of the \[Unity IAP\](https://docs.unity3d.com/Packages/com.unity.purchasing@4.0/manual/Overview.html) package to submit a purchase receipt to a custom Nakama RPC.

This RPC first checks the payload to see which app store was used to make the purchase, then validates the purchase with the appropriate app store. If the purchase is valid, it calls a separate function for each validated purchase in the array to check the purchase's product ID and give the appropriate amount of Gems to the player in their virtual wallet.

Note that for Nakama to validate purchases you must provide \[configuration variables appropriate to each app store\](https://heroiclabs.com/docs/nakama/getting-started/configuration/#iap-in-app-purchase).

{{< code type="server" >}}
\`\`\`typescript
let RpcValidateIAP: nkruntime.RpcFunction = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
 // Assumes payload is a Unity IAP receipt
 const iap = JSON.parse(payload);

 // Validate the purchases depending on which app store was used
 let validatePurchaseResponse : nkruntime.ValidatePurchaseResponse;
 switch (iap.store) {
 case 'GooglePlay':
 validatePurchaseResponse = nk.purchaseValidateGoogle(ctx.userId, iap.payload);
 break;
 case 'AppleAppStore':
 validatePurchaseResponse = nk.purchaseValidateApple(ctx.userId, iap.payload);
 break;
 default:
 logger.warn('Unrecognised app store in payload')
 return JSON.stringify({ success: false });
 break;
 }

 validatePurchaseResponse.validatedPurchases.forEach(p => rewardPurchase(ctx, logger, nk, p));
 return JSON.stringify({ success: true });
};

let rewardPurchase = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, validatedPurchase: nkruntime.ValidatedPurchase): void {
 // Here we are just dealing with consumable IAPs
 switch (validatedPurchase.productId) {
 case 'gems\_100':
 nk.walletUpdate(ctx.userId, { gems: 100 }, null, true);
 break;
 case 'gems\_1000':
 nk.walletUpdate(ctx.userId, { gems: 1000 }, null, true);
 break;
 }
};
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
type IAPPayload struct {
 Store string \`json:"store"\`
 ProductId int \`json:"productId"\`
 Payload string \`json:"payload"\`
}

func RpcValidateAPI(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
 // Get the user ID
 userId, ok := ctx.Value(runtime.RUNTIME\_CTX\_USER\_ID).(string)
 if !ok {
 logger.Error("no user id found")
 return "", runtime.NewError("no user id found", 16)
 }

 // Assumes payload is a Unity IAP receipt
 iap := &IAPPayload{}
 if err := json.Unmarshal(\[\]byte(payload), iap); err != nil {
 logger.Error("error unmarshaling payload")
 return "", runtime.NewError("iap payload invalid", 3)
 }

 // Validate the purchases depending on which app store was used
 switch iap.Store {
 case "GooglePlay":
 validatePurchaseResponse, err := nk.PurchaseValidateGoogle(ctx, userId, iap.Payload, true)
 if err != nil {
 logger.Error("error validated purchases with Google")
 return "", runtime.NewError("error validated purchases with Google", 13)
 }
 rewardPurchases(ctx, userId, logger, nk, validatePurchaseResponse)
 break
 case "AppleAppStore":
 validatePurchaseResponse, err := nk.PurchaseValidateApple(ctx, userId, iap.Payload, true)
 if err != nil {
 logger.Error("error validated purchases with Apple")
 return "", runtime.NewError("error validated purchases with Apple", 13)
 }
 rewardPurchases(ctx, userId, logger, nk, validatePurchaseResponse)
 break
 default:
 logger.Warn("unrecognised app store in payload")
 return "", runtime.NewError("unrecognised app store", 13)
 }

 return "{}", nil
}

func rewardPurchases(ctx context.Context, userId string, logger runtime.Logger, nk runtime.NakamaModule, validatedPurchaseResponse \*api.ValidatePurchaseResponse) {
 for \_, p := range validatedPurchaseResponse.ValidatedPurchases {
 // Here we are just dealing with consumable IAPs
 switch p.ProductId {
 case "gems\_100":
 walletUpdate := \[\]\*runtime.WalletUpdate{
 {
 UserID: userId,
 Changeset: map\[string\]int64{
 "gems": 100,
 },
 },
 }
 nk.WalletsUpdate(ctx, walletUpdate, true)
 break
 case "gems\_1000":
 walletUpdate := \[\]\*runtime.WalletUpdate{
 {
 UserID: userId,
 Changeset: map\[string\]int64{
 "gems": 1000,
 },
 },
 }
 nk.WalletsUpdate(ctx, walletUpdate, true)
 break
 }
 }
}
\`\`\`
{{< / code >}}

{{< missing type="server" lang="lua" / >}}

\## Purchasing in-game currency with premium currency

Now that the player has purchased a premium currency, they can use it to purchase an in-game currency, Coins. The following RPC allows the user to specify how many Gems they would like to spend on Coins. Here the conversion rate (1 Gem = 1000 Coins) is hardcoded.

{{< code type="server" >}}
\`\`\`typescript
let RpcPurchaseCoins: nkruntime.RpcFunction = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
 const request = JSON.parse(payload);

 if (!request.gemsToSpend) {
 logger.warn('No gemsToSpend specified in RpcPurchaseCoins payload.');
 return JSON.stringify({ success: false, error: 'Failed to provide gems to spend amount.' });
 }

 // Check that the user has enough gems to spend
 const account = nk.accountGetId(ctx.userId);
 if (account.wallet\['gems'\] < request.gemsToSpend) {
 logger.warn('User does not have enough gems.');
 return JSON.stringify({ success: false, error: 'Not enough gems.' });
 }

 // Spend
 const coinsPerGem = 1000;
 nk.walletUpdate(ctx.userId, { coins: coinsPerGem \* request.gemsToSpend, gems: -request.gemsToSpend });

 return JSON.stringify({ success: true });
};
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
type PurchaseCoinsPayload struct {
 GemsToSpend int \`json:"gemsToSpend"\`
}

func RpcPurchaseCoins(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
 // Get the user ID
 userId, ok := ctx.Value(runtime.RUNTIME\_CTX\_USER\_ID).(string)
 if !ok {
 logger.Error("no user id found")
 return "", runtime.NewError("no user id found", 16)
 }

 // Unmarshal the payload
 request := &PurchaseCoinsPayload{}
 if err := json.Unmarshal(\[\]byte(payload), request); err != nil {
 logger.Error("error unmarshaling payload")
 return "", runtime.NewError("purchase coins payload invalid", 3)
 }

 if request.GemsToSpend <= 0 {
 logger.Warn("no gemsToSpend specified in payload")
 return "", runtime.NewError("no gemsToSpend specified in payload", 3)
 }

 // Check that the user has enough gems to spend
 account, err := nk.AccountGetId(ctx, userId)
 if err != nil {
 logger.Error("error getting account data")
 return "", runtime.NewError("error getting account data", 13)
 }

 var wallet map\[string\]int
 if err := json.Unmarshal(\[\]byte(account.Wallet), &wallet); err != nil {
 logger.Error("error unmarshaling wallet")
 return "", runtime.NewError("error unmarshaling wallet", 13)
 }

 if wallet\["gems"\] < request.GemsToSpend {
 logger.Warn("user does not have enough gems")
 return "", runtime.NewError("you do not have enough gems", 9)
 }

 // Spend
 coinsPerGem := 1000
 coins := coinsPerGem \* request.GemsToSpend
 \_, \_, err = nk.WalletUpdate(ctx, userId, map\[string\]int64{"coins": int64(coins), "gems": int64(-request.GemsToSpend)}, nil, true)
 if err != nil {
 return "", runtime.NewError("unable to update wallet", 13)
 }

 return "{}", nil
}
\`\`\`
{{< / code >}}

{{< missing type="server" lang="lua" / >}}

\## Purchasing items with in-game currency

For this example we're going to store a configuration object inside the Nakama Storage Engine which will map each item in the game to a price in Coins. We will configure this inside our server's \`InitModule\` function.

{{< code type="server" >}}
\`\`\`typescript
 const itemPrices = {
 'iron-sword': 100,
 'iron-shield': 150,
 'steel-sword': 500
 };

 const writeRequest: nkruntime.StorageWriteRequest = {
 collection: 'configuration',
 key: 'prices',
 userId: '00000000-0000-0000-0000-000000000000', // Owned by the system user
 permissionRead: 2, // Public read
 permissionWrite: 0, // No write
 value: itemPrices
 };

 nk.storageWrite(\[ writeRequest \]);
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
itemPrices := map\[string\]int64 {
 "iron-sword": 100,
 "iron-shield": 150,
 "steel-sword": 500,
}

itemJson, err := json.Marshal(itemPrices)
if err != nil {
 logger.Error("error marshaling item prices")
 return runtime.NewError("error marshaling item prices", 13)
}

write := &runtime.StorageWrite{
 Collection: "configuration",
 Key: "prices",
 UserID: "00000000-0000-0000-0000-000000000000",
 PermissionRead: 2, // Public read
 PermissionWrite: 0, // No write
 Value: string(itemJson),
}

if \_, err := nk.StorageWrite(ctx, \[\]\*runtime.StorageWrite{write}); err != nil {
 logger.Error("error writing storage objects")
 return runtime.NewError("error writing storage objects", 13)
}
\`\`\`
{{< / code >}}

{{< missing type="server" lang="lua" / >}}

With our prices stored in the Storage Engine we can write an RPC that will allow the user to buy an item (provided they have enough Coins).

{{< code type="server" >}}
\`\`\`typescript
let RpcPurchaseItem: nkruntime.RpcFunction = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
 const request = JSON.parse(payload);

 // Make sure the user specified an item to buy
 if (!request.itemName) {
 logger.warn('No item name specified.');
 return JSON.stringify({ success: false, error: 'No item name specified.'});
 }

 // Lookup the item prices
 const readRequest: nkruntime.StorageReadRequest = {
 collection: 'configuration',
 key: 'prices',
 userId: '00000000-0000-0000-0000-000000000000'
 };

 const readResult = nk.storageRead(\[readRequest\]);
 if (readResult.length == 0)
 {
 logger.warn('No item prices in storage.');
 return JSON.stringify({ success: false, error: 'No item prices available.' });
 }

 const prices = readResult\[0\].value;

 // Check if there is a price for the requested item
 if (!prices\[request.itemName\]) {
 logger.warn(\`No price available for ${request.itemName}\`);
 return JSON.stringify({ success: false, error: \`No price available for ${request.itemName}\` });
 }

 // Check that the player has enough coins
 const account = nk.accountGetId(ctx.userId);

 if (account.wallet\['coins'\] < prices\[request.itemName\]) {
 logger.warn('Not enough coins to purchase item.');
 return JSON.stringify({ success: false, error: 'Not enough coins to purchase item.' });
 }

 // Decrease the player's coins
 nk.walletUpdate(ctx.userId, { coins: -prices\[request.itemName\] });

 // Get the player's current inventory.
 let inventory = {};

 const inventoryReadRequest: nkruntime.StorageReadRequest = {
 collection: 'economy',
 key: 'inventory',
 userId: ctx.userId
 };

 const result = nk.storageRead(\[inventoryReadRequest\]);
 if (result.length > 0) {
 inventory = result\[0\].value;
 }

 // Give the player the item (either increase quantity if they already possessed it or add one)
 if (inventory\[request.itemName\]) {
 inventory\[request.itemName\] += 1;
 } else {
 inventory\[request.itemName\] = 1;
 }

 // Define the storage write request to update the player's inventory.
 const writeRequest: nkruntime.StorageWriteRequest = {
 collection: 'economy',
 key: 'inventory',
 userId: ctx.userId,
 permissionWrite: 1,
 permissionRead: 1,
 value: inventory
 };

 // Write the updated inventory to storage.
 const storageWriteAck = nk.storageWrite(\[writeRequest\]);

 // Return an error if the write does not succeed.
 if (!storageWriteAck \|\| storageWriteAck.length == 0) {
 return JSON.stringify({ success: false, error: 'Error saving inventory.' });
 }

 return JSON.stringify({ success: true });
};
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
type PurchaseItemPayload struct {
 ItemName string \`json:"itemName"\`
}

func RpcPurchaseItem(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
 // Get the user ID
 userId, ok := ctx.Value(runtime.RUNTIME\_CTX\_USER\_ID).(string)
 if !ok {
 logger.Error("no user id found")
 return "", runtime.NewError("no user id found", 16)
 }

 // Unmarshal the payload
 request := &PurchaseItemPayload{}
 if err := json.Unmarshal(\[\]byte(payload), request); err != nil {
 logger.Error("error unmarshaling payload", err)
 return "", runtime.NewError("purchase item payload invalid", 3)
 }

 // Make sure the user specified an item to buy
 if request.ItemName == "" {
 logger.Warn("no item name specified")
 return "", runtime.NewError("no item name specified", 3)
 }

 // Lookup the item prices
 readRequest := &runtime.StorageRead{
 Collection: "configuration",
 Key: "prices",
 UserID: "00000000-0000-0000-0000-000000000000",
 }

 readResult, err := nk.StorageRead(ctx, \[\]\*runtime.StorageRead{readRequest})
 if err != nil {
 logger.Error("error reading item prices from storage", err)
 return "", runtime.NewError("error reading item prices from storage", 13)
 }

 if len(readResult) == 0 {
 logger.Warn("no item prices in storage")
 return "", runtime.NewError("no item prices in storage", 13)
 }

 // Check if there is a price for the requested item
 var prices map\[string\]int
 if err := json.Unmarshal(\[\]byte(readResult\[0\].Value), &prices); err != nil {
 logger.Error("error unmarshaling prices", err)
 return "", runtime.NewError("error unmarshaling prices", 13)
 }

 if \_, ok := prices\[request.ItemName\]; !ok {
 logger.Warn("no price available for %s", request.ItemName)
 return "", runtime.NewError(fmt.Sprintf("no price available for %s", request.ItemName), 5)
 }

 // Check that the player has enough coins to spend
 account, err := nk.AccountGetId(ctx, userId)
 if err != nil {
 logger.Error("error getting account data", err)
 return "", runtime.NewError("error getting account data", 13)
 }

 var wallet map\[string\]int
 if err := json.Unmarshal(\[\]byte(account.Wallet), &wallet); err != nil {
 logger.Error("error unmarshaling wallet", err)
 return "", runtime.NewError("error unmarshaling wallet", 13)
 }

 if wallet\["coins"\] < prices\[request.ItemName\] {
 logger.Warn("not enough coins to purchase item")
 return "", runtime.NewError("not enough coins to purchase item", 9)
 }

 // Decrease the player's coins
 \_, \_, err = nk.WalletUpdate(ctx, userId, map\[string\]int64{"coins": int64(-prices\[request.ItemName\])}, nil, true)
 if err != nil {
 logger.Error("unable to update wallet", err)
 return "", runtime.NewError("unable to update wallet", 13)
 }

 // Get the player's current inventory
 var inventory map\[string\]int

 readRequest = &runtime.StorageRead{
 Collection: "economy",
 Key: "inventory",
 UserID: userId,
 }

 readResult, err = nk.StorageRead(ctx, \[\]\*runtime.StorageRead{readRequest})
 if err != nil {
 logger.Error("error reading inventory from storage", err)
 return "", runtime.NewError("error reading inventory from storage", 13)
 }

 if len(readResult) > 0 {
 if err := json.Unmarshal(\[\]byte(readResult\[0\].Value), &inventory); err != nil {
 logger.Error("error unmarshaling inventory", err)
 return "", runtime.NewError("error unmarshaling inventory", 13)
 }
 } else {
 inventory = make(map\[string\]int)
 }

 // Give the player the item (either increase quantity if they already possessed it or add one)
 if \_, ok := inventory\[request.ItemName\]; ok {
 inventory\[request.ItemName\] += 1
 } else {
 inventory\[request.ItemName\] = 1
 }

 // Write the updated inventory to storage
 inventoryJson, err := json.Marshal(inventory)
 if err != nil {
 logger.Error("error marshaling inventory")
 return "", runtime.NewError("error marshaling inventory", 13)
 }

 writeRequest := &runtime.StorageWrite{
 Collection: "economy",
 Key: "inventory",
 UserID: userId,
 PermissionRead: 1,
 PermissionWrite: 1,
 Value: string(inventoryJson),
 }

 // Return an error if the write does not succeed
 storageWriteAck, err := nk.StorageWrite(ctx, \[\]\*runtime.StorageWrite{writeRequest})
 if err != nil \|\| len(storageWriteAck) == 0 {
 logger.Error("error saving inventory")
 return "", runtime.NewError("error saving inventory", 13)
 }

 return "{}", nil
}
\`\`\`
{{< / code >}}

{{< missing type="server" lang="lua" / >}}

\## Purchasing non-consumables with IAPs

As well as being able to purchase a virtual currency through In-App Purchases, you may wish to provide players with the ability to directly purchase non-consumable goods too.

For this example, we'll revisit our server runtime RPC from earlier that allowed players to purchase Gems. However, we'll now add the ability to purchase a non-consumable which can be restored on a different device later. The non-consumable in this instance will be the ability to become a Premium status player.

For this, once the purchase has been validated, we will set a flag in the user's metadata to indicate that they are a Premium player. This can then be used throughout the game to provide various perks/rewards.

{{< code type="server" >}}
\`\`\`typescript
let rewardPurchase = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, validatedPurchase: nkruntime.ValidatedPurchase): void {
 switch (validatedPurchase.productId) {
 // ...existing cases omitted
 case 'premium\_status':
 const account = nk.accountGetId(ctx.userId);
 const metadata = account.user.metadata;
 metadata\['premium'\] = true;
 nk.accountUpdateId(ctx.userId, null, null, null, null, null, null, metadata);
 break;
 }
};
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
func rewardPurchases(ctx context.Context, userId string, logger runtime.Logger, nk runtime.NakamaModule, validatedPurchaseResponse \*api.ValidatePurchaseResponse) {
 for \_, p := range validatedPurchaseResponse.ValidatedPurchases {
 switch p.ProductId {
 // ...existing cases omitted
 case "premium\_status":
 account, err := nk.AccountGetId(ctx, userId)
 if err != nil {
 logger.Error("unable to get account", err)
 return
 }

 var metadata map\[string\]interface{}
 if err := json.Unmarshal(\[\]byte(account.User.Metadata), &metadata); err != nil {
 logger.Error("error unmarshaling account metadata", err)
 return
 }

 metadata\["premium"\] = true
 nk.AccountUpdateId(ctx, userId, "", metadata, "", "", "", "", "")
 break
 }
 }
}
\`\`\`
{{< / code >}}

{{< missing type="server" lang="lua" / >}}

\## Restoring an IAP purchase

If a user changes their device, they should be able to restore any purchases they had previously made. This does not apply to consumable purchases (e.g. virtual currency) which will have already been "consumed" at the time of purchase, but for things such as unlocking the full game, removing ads, or becoming a Premium member, the user should receive all of the same benefits on any new device where they install your game.

For this, we will provide an RPC that the game client can call to receive a list of all the IAP Product IDs and purchase timestamps that have been verified as successful purchases in Nakama. The client can then use this information to restore the appropriate feature on the new device.

{{< code type="server" >}}
\`\`\`typescript
let RpcRestorePurchases: nkruntime.RpcFunction = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
 const purchases = nk.purchasesList(ctx.userId);

 const response = {
 purchases = purchases.validatedPurchases.map(v => { v.productId, v.purchaseTime })
 };

 return JSON.stringify(response);
};
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
type RestorePurchasesResponse struct {
 Purchases \[\]\*ValidatedPurchaseItem \`json:"purchases"\`
}

type ValidatedPurchaseItem struct {
 ProductId string \`json:"productId"\`
 PurchaseTime int64 \`json:"purchaseTime"\`
}

func RpcRestorePurchases(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
 // Get the user ID
 userId, ok := ctx.Value(runtime.RUNTIME\_CTX\_USER\_ID).(string)
 if !ok {
 logger.Error("no user id found")
 return "", runtime.NewError("no user id found", 16)
 }

 // Get the list of validated purchases
 purchases, err := nk.PurchasesList(ctx, userId, 100, "")
 if err != nil {
 logger.Error("error retrieving purchases", err)
 return "", runtime.NewError("error retrieving purchases", 13)
 }

 // Construct the response
 purchasesResponse := &RestorePurchasesResponse{
 Purchases: \[\]\*ValidatedPurchaseItem{},
 }

 for \_, purchase := range purchases.ValidatedPurchases {
 purchasesResponse.Purchases = append(purchasesResponse.Purchases, &ValidatedPurchaseItem{ProductId: purchase.ProductId, PurchaseTime: purchase.PurchaseTime.Seconds})
 }

 // Marshal the response
 jsonResponse, err := json.Marshal(purchasesResponse)
 if err != nil {
 logger.Error("error marshaling response", err)
 return "", runtime.NewError("error marshaling response", 13)
 }

 return string(jsonResponse), nil
}
\`\`\`
{{< / code >}}

{{< missing type="server" lang="lua" / >}}