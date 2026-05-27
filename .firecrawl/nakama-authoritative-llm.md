\# Authoritative Multiplayer

\*\*URL:\*\* https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/
\*\*Summary:\*\* Authoritative multiplayer is suited for gameplay which depends on central state managed by the game backend. The Nakama authoritative multiplayer engine introduces a way to run custom match logic with a fixed tick rate. Messages can be validated and state changes broadcast to connected peers.
\*\*Keywords:\*\* tick rate, game loop, host, server, join match, end match, list matches, search matches, lua, go, typescript, register match, matchcreate
\*\*Categories:\*\* nakama, authoritative, multiplayer

\-\-\-

\# Authoritative Multiplayer

In addition to \[relayed multiplayer\](../relayed/), Nakama also supports the server-authoritative multiplayer model, giving you the freedom and flexibility to decide which approach is best for your game.

In server-authoritative multiplayer, all exchanges of gameplay data are validated and broadcast by the server. In this model you write custom server runtime code for the gameplay rules to be enforced by Nakama (i.e. how many players can join, whether matches can be joined in progress, etc.).

There are no strong determinative factors that necessitate the relayed or authoritative approach over the other, it is a design decision based on the desired gameplay. Authoritative multiplayer is more suitable for gameplay which depends on central state managed by the game backend, gameplay with higher player counts per match, and where you don't want to trust game clients and instead want stricter control over gameplay rules to minimize cheating, etc.

To support multiplayer game designs which require data messages to change state maintained on the server, the authoritative multiplayer engine enables you to run custom match logic with a fixed tick rate. Messages can be validated and state changes broadcast to connected peers. This enables you to build:

1\. \*\*Asynchronous real-time authoritative multiplayer\*\*: Fast paced real-time multiplayer. Messages are sent to the server, server calculates changes to the environment and players, and data is broadcasted to relevant peers. This typically requires a high tick-rate for the gameplay to feel responsive.
2\. \*\*Active turn-based multiplayer\*\*: Some examples are Stormbound or Clash Royale, games where two or more players are connected and are playing a quick turn-based match. Players are expected to respond to turns immediately. The server receives input, validates them and broadcast to players. The expected tick-rate is quite low as rate of message sent and received is low.
3\. \*\*Passive turn-based multiplayer\*\*: A great example is Words With Friends on mobile where the gameplay can span several hours to weeks. The server receives input, validates them, stores them in the database and broadcast changes to any connected peers before shutting down the server loop until next gameplay sequence.
4\. \*\*Session-based multiplayer\*\*: For complex gameplay where you want the physics running server-side (e.g. Unity headless instances). Nakama can manage these headless instances, via an orchestration layer, and can be used for \[matchmaking\](../matchmaker/), moving players on match completion, and reporting the match results.

It is important to note that there are no out-of-the-box or generic scenarios when building your server-authoritative multiplayer game. You must define the gameplay - how many players per match, whether joining in progress is allowed, how the match ends, etc. - by writing custom \[runtime code\](../../../server-framework/).

There are several concepts to familiarize yourself with when deciding to implement the Authoritative Multiplayer feature.

\## Match handler

Match handlers represent all server-side functions grouped together to handle game inputs and operate on them. Think of it as a "blueprint" from which a match is instantiated. Your match handler establishes the gameplay rules for the match and, because a game may have multiple modes of play (e.g. Capture the Flag, Deathmatch, Free for All, etc.), you may need multiple match handlers - one for each game mode.

There are 7 functions required in any match handler. These functions are called only by Nakama, they \*\*cannot\*\* be called directly by clients or other runtime code.

\\* Match Init
\\* Match Join Attempt
\\* Match Join
\\* Match Leave
\\* Match Loop
\\* Match Terminate
\\* Match Signal

See the \[Match Handler\](../../../server-framework/typescript-runtime/function-reference/match-handler/) and \[Match Runtime\](../../../server-framework/typescript-runtime/function-reference/match-runtime/) function reference for details.

These functions define the state and lifecycle of a given match, with any single Nakama node capable of running thousands of matches depending on hardware and player count. The match handler and state of a given match is stored on a particular Nakama instance, with that instance becoming the \_host\_ for that match.

A single node is responsible for this to ensure the highest level of consistency accessing and updating the state and to avoid potential delays reconciling distributed state.

{{< note "important" "Nakama Enterprise Only" >}}
Match presences are replicated so all nodes in a cluster have immediate access to both a list of matches and details about match participants. Balancing among nodes is done automatically, with new matches created on the most appropriate node and never on a node that has entered shutdown.

Migrating from Nakama Open-Source to Nakama Enterprise is seamless, and does not require any client or server-side code change. Presence replication, inter-cluster data exchange and message routing all happens transparently to your match handler as if it was operating on a single-instance cluster.
{{< /note >}}

Every running match is self-contained, it cannot communicate with or affect any other matches. Communication with matches is done \*\*only\*\* via clients sending match data. Nakama internally manages the CPU scheduling and Memory allocation to each match ensuring fair and balance distribution of load on a single instance or all instances in the cluster.

{{< note "important" >}}
The match signal function can be used to accomplish this in a limited manner: reserve a place in a match for a given player or handoff players/data to another match. This should only be used as \*\*rare exception\*\* and not standard practice.
{{< /note >}}

Match handlers run even if there are no presences connected or active. You must account for the handling of idle or empty matches in your match runtime logic.

{{< code type="server" >}}
\`\`\`go
type LobbyMatch struct{}

type LobbyMatchState struct {
 presences map\[string\]runtime.Presence
 emptyTicks int
}

func (m \*LobbyMatch) MatchInit(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, params map\[string\]interface{}) (interface{}, int, string) {
 state := &LobbyMatchState{
 emptyTicks: 0,
 presences: map\[string\]runtime.Presence{},
 }
 tickRate := 1 // 1 tick per second = 1 MatchLoop func invocations per second
 label := ""
 return state, tickRate, label
}

func (m \*LobbyMatch) MatchJoin(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences \[\]runtime.Presence) interface{} {
 lobbyState, ok := state.(\*LobbyMatchState)
 if !ok {
 logger.Error("state not a valid lobby state object")
 return nil
 }

 for i := 0; i < len(presences); i++ {
 lobbyState.presences\[presences\[i\].GetSessionId()\] = presences\[i\]
 }

 return lobbyState
}

func (m \*LobbyMatch) MatchLeave(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences \[\]runtime.Presence) interface{} {
 lobbyState, ok := state.(\*LobbyMatchState)
 if !ok {
 logger.Error("state not a valid lobby state object")
 return nil
 }

 for i := 0; i < len(presences); i++ {
 delete(lobbyState.presences, presences\[i\].GetSessionId())
 }

 return lobbyState
}

func (m \*LobbyMatch) MatchLoop(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages \[\]runtime.MatchData) interface{} {
 lobbyState, ok := state.(\*LobbyMatchState)
 if !ok {
 logger.Error("state not a valid lobby state object")
 return nil
 }

 // If we have no presences in the match according to the match state, increment the empty ticks count
 if len(lobbyState.presences) == 0 {
 lobbyState.emptyTicks++
 }

 // If the match has been empty for more than 100 ticks, end the match by returning nil
 if lobbyState.emptyTicks > 100 {
 return nil
 }

 return lobbyState
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`typescript
const matchInit = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: {\[key: string\]: string}): {state: nkruntime.MatchState, tickRate: number, label: string} {
 return {
 state: { presences: {}, emptyTicks: 0 },
 tickRate: 1, // 1 tick per second = 1 MatchLoop func invocations per second
 label: ''
 };
};

const matchJoin = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence\[\]) : { state: nkruntime.MatchState } \| null {
 presences.forEach(function (p) {
 state.presences\[p.sessionId\] = p;
 });

 return {
 state
 };
}

const matchLeave = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence\[\]) : { state: nkruntime.MatchState } \| null {
 presences.forEach(function (p) {
 delete(state.presences\[p.sessionId\]);
 });

 return {
 state
 };
}

const matchLoop = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, messages: nkruntime.MatchMessage\[\]) : { state: nkruntime.MatchState} \| null {
 // If we have no presences in the match according to the match state, increment the empty ticks count
 if (state.presences.length === 0) {
 state.emptyTicks++;
 }

 // If the match has been empty for more than 100 ticks, end the match by returning null
 if (state.emptyTicks > 100) {
 return null;
 }

 return {
 state
 };
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`lua
local M = {}

function M.match\_init(context, initial\_state)
 local state = {
 presences = {},
 empty\_ticks = 0
 }
 local tick\_rate = 1 -- 1 tick per second = 1 MatchLoop func invocations per second
 local label = ""

 return state, tick\_rate, label
end

function M.match\_join(context, dispatcher, tick, state, presences)
 for \_, presence in ipairs(presences) do
 state.presences\[presence.session\_id\] = presence
 end

 return state
end

function M.match\_leave(context, dispatcher, tick, state, presences)
 for \_, presence in ipairs(presences) do
 state.presences\[presence.session\_id\] = nil
 end

 return state
end

function M.match\_loop(context, dispatcher, tick, state, messages)
 \-\- Get the count of presences in the match
 local totalPresences = 0
 for k, v in pairs(state.presences) do
 totalPresences = totalPresences + 1
 end

 \-\- If we have no presences in the match according to the match state, increment the empty ticks count
 if totalPresences == 0 then
 state.empty\_ticks = state.empty\_ticks + 1
 end

 \-\- If the match has been empty for more than 100 ticks, end the match by returning nil
 if state.empty\_ticks > 100 then
 return nil
 end

 return state
end
\`\`\`
{{< / code >}}

Matches cannot be stopped from the outside and end only when one of the lifecycle functions returns a \`nil\` state.

In order to make the match handler available it must be registered.

{{< code type="server">}}
\`\`\`go
func InitModule(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
 if err := initializer.RegisterMatch("lobby", func(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
 return &LobbyMatch{}, nil
 }); err != nil {
 logger.Error("unable to register: %v", err)
 return err
 }
}
\`\`\`
{{< / code >}}

{{< code type="server">}}
\`\`\`typescript
let InitModule: nkruntime.InitModule = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
 initializer.registerMatch('lobby', {
 matchInit,
 matchJoinAttempt,
 matchJoin,
 matchLeave,
 matchLoop,
 matchSignal,
 matchTerminate
 });
}
\`\`\`
{{< / code >}}

{{< code type="server">}}
\`\`\`lua
\-\- the name must be the same as the match handler file (e.g. lobby.lua)
nk.register\_matchmaker\_matched(function(context, matched\_users)
 local match\_id, err = nk.match\_create("lobby", { invited = matched\_users })
 return match\_id
end)
\`\`\`
{{< / code >}}

\## Tick rate

While most match handler functions are called due to user behavior or internal server processes, the server will \*\*periodically call the match loop function\*\* even when there is no input waiting to be processed. The logic is able to advance the game state as needed, and can also validate incoming input and kick inactive players.

Your tick rate represents the desired frequency (per second) at which the server calls the match loop function - i.e. how often the match should update. For example a rate of \`10\` represents 10 ticks to the match loop per second.

The server always tries to maintain even \_start\_ point spacing. Using the tick rate of \`10\` example, each loop will start \`100ms\` after the last one \_started\_. Best practice is to leave as much time as possible between loops, allowing for the irregularly called non-loop functions to execute in the gaps between loops.

It is important that your game loop logic and configured tick rate do not cause the server to fall behind - i.e. each loop must be able to finish before the next is scheduled (less than \`100ms\` in our example). If the match loops do fall behind, the server will first try to "catch up" by starting the next loop as soon as possible. If too many loops fall behind - typically the result of poor loop logic design - the server will end the match.

Tick rate is configurable and typical frequencies range from once per second for turn-based games to dozens of times per second for fast-paced gameplay. Some considerations to keep in mind when choosing your tick rate:

\\* Select the lowest possible tick rate that provides an acceptable player experience (no lag, etc.)
\\* Higher tick rates mean less gaps between match loops, and more responsive "feel" for players
\\* Always start with a low rate and increase in small increments (1-2) until the desired experience is achieved
\\* The lower your tick rate then more matches than can be run concurrently per CPU core
\\* Each match handler can have a different tick rate, such as for different game modes

\## Match state

Nakama exposes an in-memory region for authoritative matches to use for the duration of the match to store their state. This can include any information needed to keep track of game data and client behavior during the course of the match.

Each match maintains its own individual, isolated state. This of this state as the result of continuous transformations applied to an initial state based on the loop of user input after validation. Note that these changes in state are \*\*not\*\* automatically send to connected clients. You must do this manually within your match handler logic by \[broadcasting\](#broadcast-message) the appropriate op codes and data.

\### Send data messages

Unlike \[sending messages in relayed multiplayer\](../relayed/#send-data-messages), in authoritative matches received messages are not automatically rebroadcast to all other connected clients. Your match logic must explicitly call the \[\`broadcast\` function\](../../../server-framework/typescript-runtime/function-reference/match-runtime/#BroadcastMessage) to send a message.

Each message contains an \[Op code\](#op-codes) as well as the payload.

{{< code type="server">}}
\`\`\`go
const MATCH\_START\_OPCODE = 7

matchStartData := &map\[string\]interface{} {
 "started": true,
 "roundTimer": 100,
}

data, err := json.Marshal(matchStartData)
if err != nil {
 logger.Error("error marshaling match start data", err)
 return nil
}

reliable := true
dispatcher.BroadcastMessage(MATCH\_START\_OPCODE, data, nil, nil, reliable)
\`\`\`
{{< / code >}}

{{< code type="server">}}
\`\`\`typescript
const matchStartOpcode = 7

const matchStartData = {
 started: true,
 roundTimer: 100
};

dispatcher.broadcastMessage(matchStartOpcode, json.stringify(matchStartData), null, null, true);
\`\`\`
{{< / code >}}

{{< code type="server">}}
\`\`\`lua
local match\_start\_opcode = 7

match\_start\_data = {
 started = true,
 round\_timer = 100
}

dispatcher.broadcast\_message(match\_start\_opcode, nk.json\_encode(match\_start\_data), nil, nil)
\`\`\`
{{< / code >}}

The binary content (payload) in each data message should be as \*\*small as possible\*\* within the maximum transmission unit (MTU) of \`1500\` bytes. It is common to use JSON and preferable to use a compact binary format like \[Protocol Buffers\](https://developers.google.com/protocol-buffers/) or \[FlatBuffers\](https://google.github.io/flatbuffers/).

When further reducing the message size and/or frequency is not possible, it is best to prioritize sending \*\*fewer messages\*\*. For example, 1 message of \`1000\` bytes per second is better than 5 messages of \`200\` bytes per second.

Client messages are buffered by the server in the order received and, when the next match loop runs, are handed off as a batch. Best practice is to try and maintain no more than 1 message per tick, per presence to the server, and the same from the server to each presence.

If there are too many messages for your configured tick rate some may be dropped by the server, and an error will be logged. To avoid continuously dropping messages, try:

\\* Decreasing the message send rate from clients to the server
\\* Increasing the tick rate so messages are consumed more often
\\* Increasing the \[buffer size\](../../../getting-started/configuration/#match.input\_queue\_size)

\#### Op codes

An op code is a numeric identifier for the type of message sent. Op codes can provide insight into the purpose and content of a message before you decode it.

They can be used to define commands within the gameplay which belong to certain user actions, such as:

\\* Initial state synchronization
\\* Ready status
\\* Ping / Pong
\\* Game state update
\\* Emote

Using bitwise operations to encode data, you can also include additional information in the Op code field.

See the \[Fish Game tutorial\](../../../tutorials/unity/fishgame/#operation-codes) for an example implementation.

\#### Broadcast vs BroadcastDeferred

The \`dispatcher\` type passed into the \[match handler functions\](../../../server-framework/typescript-runtime/function-reference/match-handler/) enables you to send data from a match to one or more presences \_in that match\_.

The are two methods available for sending data, \`Broadcast\` and \`BroadcastDeferred\`.

\`Broadcast\` can be called multiple times per function, but best practice is to limit outgoing data to one message per presence in each loop. Using multiple calls per loop is only recommended if you need to send a different message to each presence.

There is only one difference between using \`Broadcast\` vs. \`BroadcastDeferred\` - where the former sends the data out immediately when called, the latter does not send the data until the end of the loop.

Keep in mind that if you are sending/broadcasting too much data and the downwards connection to the client is slower than the match data send rate, it can fill up the client connection's send buffer queue and force the server to disconnect the connection to prevent memory overflows.

\### Receive data messages

The server delivers data in the order it processes data messages from clients. A client can add a callback for incoming match data messages. This should be done before they \[join\](#join-a-match) and \[leave\](#leave-a-match) a match.

{{< code type="client" >}}
\`\`\`javascript
socket.onmatchdata = (result) => {
 var content = result.data;

 switch (result.op\_code) {
 case 101:
 console.log("A custom opcode.");
 break;
 default:
 console.log("User %o sent %o", result.presence.user\_id, content);
 }
};
\`\`\`
{{< / code >}}

{{< code type="client" >}}
\`\`\`csharp
// Use whatever decoder for your message contents.
var enc = System.Text.Encoding.UTF8;
socket.ReceivedMatchState += newState =>
{
 var content = enc.GetString(newState.State);

 switch (newState.OpCode)
 {
 case 101:
 Console.WriteLine("A custom opcode.");
 break;
 default:
 Console.WriteLine("User '{0}'' sent '{1}'", newState.UserPresence.Username, content);
 }
};
\`\`\`
{{< / code >}}

{{< code type="client" >}}
\`\`\`swift
socket.onMatchData = { matchData in
 let content = String(data: matchData.data, encoding: .utf8)!

 switch matchData.opCode {
 case 101:
 print("A custom opcode.")
 default:
 print("User \\(matchData.presence.userID) sent \\(content)")
 }
}
\`\`\`
{{< / code >}}

{{< code type="client" >}}
\`\`\`dart
socket.onMatchData.listen((matchData) {
 final content = utf8.decode(matchData.data);

 switch (matchData.opCode) {
 case 101:
 print('A custom opcode.');
 break;
 default:
 print('User ${matchData.presence.userId} sent $content');
 }
});
\`\`\`
{{< / code >}}

{{< code type="client" >}}
\`\`\`cpp
rtListener->setMatchDataCallback(\[\](const NMatchData& data)
{
 switch (data.opCode)
 {
 case 101:
 std::cout << "A custom opcode." << std::endl;
 break;
 default:
 std::cout << "User " << data.presence.userId << " sent " << data.data << std::endl;
 break;
 }
});
\`\`\`
{{< / code >}}

{{< code type="client" >}}
\`\`\`java
SocketListener listener = new AbstractSocketListener() {
 @Override
 public void onMatchData(final MatchData matchData) {
 System.out.format("Received match data %s with opcode %d", matchData.getData(), matchData.getOpCode());
 }
};
\`\`\`
{{< / code >}}

{{< code type="client" framework="godot3" >}}
\`\`\`gdscript
func \_ready():
 # First, setup the socket as explained in the authentication section.
 socket.connect("received\_match\_state", self, "\_on\_match\_state")

func \_on\_match\_state(p\_state : NakamaRTAPI.MatchData):
 print("Received match state with opcode %s, data %s" % \[p\_state.op\_code, parse\_json(p\_state.data)\])
\`\`\`
{{< / code >}}

{{< code type="client" framework="godot4" >}}
\`\`\`gdscript
func \_ready():
 # First, setup the socket as explained in the authentication section.
 socket.received\_match\_state.connect(self.\_on\_match\_state)

func \_on\_match\_state(p\_state : NakamaRTAPI.MatchData):
 print("Received match state with opcode %s, data %s" % \[p\_state.op\_code, JSON.parse\_string(p\_state.data)\])
\`\`\`
{{< / code >}}

{{< code type="client" framework="defold" >}}
\`\`\`lua
socket.on\_matchdata(function(message)
 local data = json.decode(message.match\_data.data)
 local op\_code = tonumber(message.match\_data.op\_code)
end)
\`\`\`
{{< / code >}}

{{< missing type="client" lang="bash" />}}
{{< missing type="client" lang="shell" />}}

\## Match label

Use match labels to highlight what the match wants to advertise about itself to Nakama and your player base. This can include details like the game mode, whether it is open or closed, number of players, match status, etc.

Match labels can be either a \*\*simple string\*\* or \*\*JSON\*\* value. They are usable via the \[Match Listing API\](../match-listing/) to filter matches.

Keep in mind that you can only use \*\*\[search queries\](../query-syntax/)\*\* for match labels with a \*\*JSON value\*\*. For match labels with a \*\*simple string value\*\* (e.g. \`"team-deathmatch"\`), you can only perform an \*\*exact match\*\* using the \`label\` parameter.

Indexed querying is both more effective and more useful in match listing and, for this reason, it is recommended and preferable to use JSON match labels. Some other best practices to keep in mind:

\\* Match labels have a 2kb size limit
\\* Update labels as infrequently as possible (i.e. no more than once per tick)
\\* Label updates are processed in batches, resulting in a point-in-time view

\## Managing matches

\### Create a match

Authoritative matches can be created on the server either \[manually\](#manually) or via the \[matchmaker\](#matchmaker).

\#### Manually

You can use an RPC function which submits some user IDs to the server and will create a match.

A match ID will be created which could be sent out to the players with an in-app notification or push message (or both). This approach is great when you want to manually create a match and compete with specific users.

{{< code type="server" >}}
\`\`\`lua
local nk = require("nakama")

local function create\_match(context, payload)
 local modulename = "pingpong"
 local setupstate = { initialstate = payload }
 local matchid = nk.match\_create(modulename, setupstate)

 return nk.json\_encode({ matchid = matchid })
end

nk.register\_rpc(create\_match, "create\_match\_rpc")
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
func CreateMatchRPC(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
 params := make(map\[string\]interface{})

 if err := json.Unmarshal(\[\]byte(payload), ¶ms); err != nil {
 return "", err
 }

 modulename := "pingpong" // Name with which match handler was registered in InitModule, see example above.

 if matchId, err := nk.MatchCreate(ctx, modulename, params); err != nil {
 return "", err
 } else {
 return matchId, nil
 }
}

// Register as RPC function, this call should be in InitModule.
if err := initializer.RegisterRpc("create\_match\_rpc", CreateMatchRPC); err != nil {
 logger.Error("Unable to register: %v", err)
 return err
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`typescript
function rpcCreateMatch(context: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
 var matchId = nk.matchCreate('pingpong', payload);
 return JSON.stringify({ matchId });
}
\`\`\`
{{< / code >}}

\#### Matchmaker

Use the \[matchmaker\](../matchmaker/) to find opponents and use the matchmaker matched callback on the server to create an authoritative match and return a match ID. This uses the standard matchmaker API on the client.

The clients will receive the matchmaker callback as normal with a match ID.

{{< code type="server" >}}
\`\`\`lua
local nk = require("nakama")

local function makematch(context, matched\_users)
 \-\- print matched users
 for \_, user in ipairs(matched\_users) do
 local presence = user.presence
 nk.logger\_info(("Matched user '%s' named '%s'"):format(presence.user\_id, presence.username))
 for k, v in pairs(user.properties) do
 nk.logger\_info(("Matched on '%s' value '%s'"):format(k, v))
 end
 end

 local modulename = "pingpong"
 local setupstate = { invited = matched\_users }
 local matchid = nk.match\_create(modulename, setupstate)
 return matchid
end

nk.register\_matchmaker\_matched(makematch)
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`go
func MakeMatch(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, entries \[\]runtime.MatchmakerEntry) (string, error) {
 for \_, e := range entries {
 logger.Info("Matched user '%s' named '%s'", e.GetPresence().GetUserId(), e.GetPresence().GetUsername())

 for k, v := range e.GetProperties() {
 logger.Info("Matched on '%s' value '%v'", k, v)
 }
 }

 matchId, err := nk.MatchCreate(ctx, "pingpong", map\[string\]interface{}{"invited": entries})

 if err != nil {
 return "", err
 }

 return matchId, nil
}

// Register as matchmaker matched hook, this call should be in InitModule.
if err := initializer.RegisterMatchmakerMatched(MakeMatch); err != nil {
 logger.Error("Unable to register: %v", err)
 return err
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`typescript
function matchmakerMatched(context: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult\[\]): string {
 matches.forEach(function (match) {
 logger.info("Matched user '%s' named '%s'", match.presence.userId, match.presence.username);

 Object.keys(match.properties).forEach(function (key) {
 logger.info("Matched on '%s' value '%v'", key, match.properties\[key\])
 });
 });

 try {
 const matchId = nk.matchCreate("pingpong", { invited: matches });
 return matchId;
 } catch (err) {
 logger.error(err);
 throw (err);
 }
}

// ...

initializer.registerMatchmakerMatched(matchmakerMatched);
\`\`\`
{{< / code >}}

The matchmaker matched hook must return a match ID or \`nil\` if the match should proceed as relayed multiplayer.

The string passed into the match create function depends on the server runtime language used:

\- For \_Lua\_ it should be the module name. In this example it is a file named \`pingpong.lua\`, so the match module is \`pingpong\`.
\- For \_Go\_ and \_TypeScript\_ it must be the registered name of a match handler function. In the example above we registered it as \`pingpong\` when invoking \`initializer.RegisterMatch\` in the \`InitModule\` function.

\### Join a match

Players are not in the match until they join even after being matched by the matchmaker. This enables players to opt out of matches they decide not to play.

This can be done by clients in the same way as with relayed multiplayer. A full example of how to do this is covered \[here\](../relayed/#join-a-match).

\### Leave a match

Users can leave a match at any point. This can be done by clients in the same way as with relayed multiplayer. A full example of how to do this is covered \[here\](../relayed/#leave-a-match).

When leaving a match, the \`LeaveMatch\` lifecycle match handler function is called and the reason for the leave is added: whether the player left the match or disconnected. In the case of disconnects you can decide to temporarily reserve their seat.

Remember that unlike relayed matches, authoritative matches \*\*do not\*\* end even if all players have left. This is normal and intended to allow you to support use cases where players are allowed to temporarily disconnect while the game world continues to advance.

Authoritative match handlers will only stop when any of the callbacks return a \`nil\` state. You can choose to do this at any point during the lifetime of the match, whether or not there are still players connected to it.

\### Match migration

{{< note "important" "Nakama Enterprise Only" >}}
{{< / note >}}

When a match is terminated due to the start of a \[graceful shutdown\](../../../getting-started/configuration/#shutdown\_grace\_sec) of a Nakama instance, this grace period can be used to migrate players to a new match.

First you will create a new match for them or find an existing match they can join via \[match listing\](../match-listing/). Then send a \[dispatcher broadcast\](#send-data-messages) with this new match info to the affected clients. Finally you can wait for them to leave their current match or, if necessary, forcibly kick them from it:

{{< code type="server" >}}
\`\`\`go
// Define an op code for sending a new match id to remaining presences
const newMatchOpCode = 999

func (m \*LobbyMatch) MatchTerminate(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{} {
 logger.Debug("match will terminate in %d seconds", graceSeconds)

 var matchId string

 // Find an existing match for the remaining connected presences to join
 limit := 1
 authoritative := true
 label := ""
 minSize := 2
 maxSize := 4
 query := "\*"
 availableMatches, err := nk.MatchList(ctx, limit, authoritative, label, minSize, maxSize, query)
 if err != nil {
 logger.Error("error listing matches", err)
 return nil
 }

 if len(availableMatches) > 0 {
 matchId = availableMatches\[0\].MatchId
 } else {
 // No available matches, create a new match instead
 matchId, err = nk.MatchCreate(ctx, "match", nil)
 if err != nil {
 logger.Error("error creating match", err)
 return nil
 }
 }

 // Broadcast the new match id to all remaining connected presences
 data := map\[string\]string{
 matchId: matchId,
 }

 dataJson, err := json.Marshal(data)
 if err != nil {
 logger.Error("error marshaling new match message")
 return nil
 }

 dispatcher.BroadcastMessage(newMatchOpCode, dataJson, nil, nil, true)

 return state
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`typescript
// Define an op code for sending a new match id to remaining presences
const newMatchOpCode = 999;

const matchTerminate = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, graceSeconds: number) : { state: nkruntime.MatchState} \| null {
 logger.debug(\`Match will terminate in ${graceSeconds} seconds.\`);

 let matchId = null;

 // Find an existing match for the remaining connected presences to join
 const limit = 1;
 const authoritative = true;
 const label = "";
 const minSize = 2;
 const maxSize = 4;
 const query = "\*";
 const availableMatches = nk.matchList(limit, authoritative, label, minSize, maxSize, query);

 if (availableMatches.length > 0) {
 matchId = availableMatches\[0\].matchId;
 } else {
 // No available matches, create a new match instead
 matchId = nk.matchCreate("match", { invited: state.presences });
 }

 // Broadcast the new match id to all remaining connected presences
 dispatcher.broadcastMessage(newMatchOpCode, JSON.stringify({ matchId }), null, null, true);

 return {
 state
 };
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`lua
\-\- Define an op code for sending a new match id to remaining presences
local new\_match\_op\_code = 999

function M.match\_terminate(context, dispatcher, tick, state, grace\_seconds)
 local message = "Server shutting down in " .. grace\_seconds .. " seconds"

 local match\_id

 \-\- Find an existing match for the remaining connected presences to join
 local limit = 1;
 local authoritative = true;
 local label = "";
 local min\_size = 2;
 local max\_size = 4;
 local query = "\*";
 local available\_matches = nk.match\_list(limit, authoritative, label, min\_size, max\_size, query);

 if #available\_matches > 0 then
 match\_id = available\_matches\[0\].match\_id;
 else
 \-\- No available matches, create a new match instead
 match\_id = nk.match\_create("match", { invited = state.presences });
 end

 \-\- Broadcast the new match id to all remaining connected presences
 dispatcher.broadcast\_message(new\_match\_op\_code, nk.json\_encode({ \["matchId"\] = match\_id }))

 return state
end
\`\`\`
{{< / code >}}

\## Best practices

\### Storing match state data

{{< code type="server" >}}
\`\`\`go
type LobbyMatchState struct {
 presences map\[string\]runtime.Presence
 started bool
}

func (m \*LobbyMatch) MatchInit(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, params map\[string\]interface{}) (interface{}, int, string) {
 state := &LobbyMatchState{
 presences: map\[string\]runtime.Presence{},
 started: false,
 }
 tickRate := 1
 label := ""
 return state, tickRate, label
}

func (m \*LobbyMatch) MatchLoop(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages \[\]runtime.MatchData) interface{} {
 lobbyState, ok := state.(\*LobbyMatchState)
 if !ok {
 logger.Error("state not a valid lobby state object")
 }

 if (len(lobbyState.presences) > 2) {
 lobbyState.started = true;
 }

 return lobbyState
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`typescript
const matchInit = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: {\[key: string\]: string}): {state: nkruntime.MatchState, tickRate: number, label: string} {
 return {
 state: { presences: {}, started: false },
 tickRate,
 label: ''
 };
};

const matchLoop = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, messages: nkruntime.MatchMessage\[\]) : { state: nkruntime.MatchState} \| null {
 if (state.presences.length > 2) {
 state.started = true;
 }

 return {
 state
 };
}

\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`lua
local M = {}

function M.match\_init(context, initial\_state)
 local state = {
 presences = {},
 started = false
 }
 local tick\_rate = 1
 local label = ""

 return state, tick\_rate, label
end

function M.match\_loop(context, dispatcher, tick, state, messages)
 \-\- Get the count of presences in the match
 local totalPresences = 0
 for k, v in pairs(state.presences) do
 totalPresences = totalPresences + 1
 end

 if totalPresences > 2 then
 state.started = true
 end

 return state
end
\`\`\`
{{< / code >}}