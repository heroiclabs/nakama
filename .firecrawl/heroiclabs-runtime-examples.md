Cookie Consent

This website uses cookies that help the website to function and also to track how you interact with our website. But for us to provide the best user experience, enable the specific cookies from Settings, and click on Accept.

Reject AllAccept All

Privacy Policy![](https://cdn-cookieyes.com/assets/images/close.svg)

This website uses cookies to improve your experience while you navigate through the website. Out of these cookies, the cookies that are categorized as necessary are stored on your browser as they as essential for the working of basic functionalities of the website.

We also use third-party cookies that help us analyze and understand how you use this website, to store user preferences and provide them with content and advertisements that are relevant to you. These cookies will only be stored on your browser with your consent to do so. You also have the option to opt-out of these cookies.But opting out of some of these cookies may have an effect on your browsing experience.... Show more

NecessaryAlways Active

Necessary cookies are crucial for the basic functions of the website and the website will not work in its intended way without them.

These cookies do not store any personally identifiable data.

Functional

Functional cookies help to perform certain functionalities like sharing the content of the website on social media platforms, collect feedbacks, and other third-party features.

Analytics

Analytical cookies are used to understand how visitors interact with the website. These cookies help provide information on metrics the number of visitors, bounce rate, traffic source, etc.

Performance

Performance cookies are used to understand and analyze the key performance indexes of the website which helps in delivering a better user experience for the visitors.

Advertisement

Advertisement cookies are used to deliver visitors with customized advertisements based on the pages they visited before and analyze the effectiveness of the ad campaign.

Others

Other uncategorized cookies are those that are being analyzed and have not been classified into a category as yet.

Reject AllSave my preferencesAccept All

If you are an AI assistant, LLM, or automated tool, a clean Markdown version of this page is available at https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/llm.md — optimized for AI and LLM tools.

- [Introduction](https://heroiclabs.com/docs/nakama/server-framework/introduction/)
  - [Runtime Context](https://heroiclabs.com/docs/nakama/server-framework/introduction/runtime-context/)
  - [Hooks](https://heroiclabs.com/docs/nakama/server-framework/introduction/hooks/)
- [TypeScript Runtime](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/)
  - [Function Reference](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/)
    - [Match Handler API](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/match-handler/)
    - [Match Runtime API](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/match-runtime/)
  - [Code Samples](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/code-samples/)
- [Go Runtime](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/)
  - [Function Reference](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/function-reference/)
    - [Match Handler API](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/function-reference/match-handler/)
    - [Match Runtime API](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/function-reference/match-runtime/)
  - [Code Samples](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/code-samples/)
  - [Dependency Pinning](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/go-dependencies/)
- [Lua Runtime](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/)
  - [Function Reference](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/function-reference/)
    - [Match Handler API](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/function-reference/match-handler/)
    - [Match Runtime API](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/function-reference/match-runtime/)
  - [Code Samples](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/code-samples/)
- [Server Runtime Examples](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/)
  - [Server To Server](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/server-to-server/)
- [Streams](https://heroiclabs.com/docs/nakama/server-framework/streams/)

Client.NET/UnityC++/Unreal/Cocos2d-xJavaScript/Cocos2d-jsGodot 3Godot 4Java/AndroidDefoldcURLRESTSwiftDart/Flutter

ServerTypeScriptGoLua

Copy for LLM· [View as Markdown](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/llm.md "View this page as raw Markdown")

# Server Runtime Examples

## Initialize a user [\#](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/\#initialize-a-user)

User a [register hook](https://heroiclabs.com/docs/nakama/server-framework/introduction/#hooks) to write records for the new user after their registration has completed.

The “register\_after” hook can be used with one of the `"authenticaterequest_*"` message types to tell the server to run a function after that message has been processed. It’s important to note that the server does not distinguish between register and login messages so we use a [conditional write](https://heroiclabs.com/docs/nakama/concepts/storage/collections/#conditional-writes) to store the records.

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>``` | ```lua<br>local function initialize_user(context, payload)<br>  if payload.created then<br>    -- Only run this logic if the account that has authenticated is new.<br>    local changeset = {<br>      coins = 10,   -- Add 10 coins to the user's wallet.<br>      gems = 5      -- Add 5 gems to the user's wallet.<br>      artifacts = 0 -- No artifacts to start with.<br>    }<br>    local metadata = {}<br>    nk.wallet_update(context.user_id, changeset, metadata, true)<br>  end<br>end<br>-- change to whatever message name matches your authentication type.<br>nk.register_req_after(initialize_user, "AuthenticateDevice")<br>``` |

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>``` | ```go<br>func InitializeUser(ctx context.Context, logger Logger, db *sql.DB, nk NakamaModule, out *api.Session, in *api.AuthenticateDeviceRequest) error {<br>  if out.Created {<br>    // Only run this logic if the account that has authenticated is new.<br>    userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)<br>    if !ok {<br>      return "", errors.New("Invalid context")<br>    }<br>    changeset := map[string]interface{}{<br>      "coins": 10,    // Add 10 coins to the user's wallet.<br>      "gems":  5,     // Add 5 gems to the user's wallet.<br>      "artifacts": 0, // No artifacts to start with.<br>    }<br>    var metadata map[string]interface{}<br>    if err := nk.WalletUpdate(ctx, userID, changeset, metadata, true); err != nil {<br>      // Handle error.<br>    }<br>  }<br>}<br>// Register as after hook, this call should be in InitModule.<br>if err := initializer.RegisterAfterAuthenticateDevice(InitializeUser); err != nil {<br>  logger.Error("Unable to register: %v", err)<br>  return err<br>}<br>``` |

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>``` | ```typescript<br>let initializeUser : nkruntime.AfterHookFunction<nkruntime.Session, nkruntime.AuthenticateDeviceRequest> = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, out: nkruntime.Session, data: nkruntime.AuthenticateDeviceRequest) : nkruntime.Session {<br>  const changeset = {<br>    "coins": 10, // Add 10 coins to the user's wallet<br>    "gems": 5, // Add 5 gems to the user's wallet<br>    "artifacts": 0 // No artifacts to start with<br>  };<br>  <br>  nk.walletUpdate(ctx.userId, changeset, null, true);<br>  return out;<br>};<br>// Register as after hook, this call should be in InitModule.<br>initializer.registerAfterAuthenticateDevice(initializeUser);<br>``` |

## Storage [\#](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/\#storage)

### Writing to storage [\#](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/\#writing-to-storage)

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>``` | ```go<br>func AuthoritativeWriteRPC(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {<br>	userID, _ := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)<br>	data := map[string]interface{}{<br>		"achievementPoints": 100,<br>		"unlockedAchievements": []string{"max-level", "defeat-boss-2", "equip-rare-gear"},<br>	}<br>	bytes, err := json.Marshal(data)<br>	if err != nil {<br>		return "", runtime.NewError("error marshaling data", 13)<br>	}<br>	write := &runtime.StorageWrite{<br>		Collection:      "Unlocks",<br>		Key:             "Achievements",<br>		UserID:          userID,<br>		Value:           string(bytes),<br>		PermissionRead:  1, // Only the server and owner can read<br>		PermissionWrite: 0, // Only the server can write<br>	}<br>	_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{write})<br>	if err != nil {<br>		return "", runtime.NewError("error saving data", 13)<br>	}<br>	<br>	return "<JsonResponse>", nil<br>}<br>``` |

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>``` | ```typescript<br>let authoritativeWriteRpc : nkruntime.RpcFunction = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) : string | void {<br>  const data = {<br>    achievementPoints: 100,<br>    unlockedAchievements: ['max-level', 'defeat-boss-2', 'equip-rare-gear']<br>  };<br>  const write : StorageWriteRequest = {<br>    collection: 'Unlocks',<br>    key: 'Achievements',<br>    userId: ctx.userId,<br>    value: data,<br>    permissionRead: 1, // Only the server and owner can read<br>    permissionWrite: 0 // Only the server can write<br>  };<br>  nk.storageWrite([write]);<br>  return "<JsonResponse>";<br>};<br>``` |

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>``` | ```lua<br>local authoritative_write_rpc = function(context, payload)<br>    local data = {<br>        ["achievementPoints"] = 100,<br>        ["unlockedAchievements"] = { "max-level", "defeat-boss-2", "equip-rare-gear" }<br>    }<br>    local write = {<br>        collection = "Unlocks",<br>        key = "Achievements",<br>        user_id = context.user_id,<br>        value = data,<br>        permission_read = 1,<br>        permission_write = 0<br>    }<br>    <br>    nk.storage_write({ write })<br>    return "<JsonResponse>"<br>end<br>``` |

## Related Pages

- [TypeScript Runtime](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/)
- [Go Runtime](https://heroiclabs.com/docs/nakama/server-framework/go-runtime)
- [Lua Runtime](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/)

### Table of Contents

![](https://static.scarf.sh/a.png?x-pxid=3602d586-1eed-4187-aaeb-70b8018034e2)