\# How to Send Server-Side Analytic Events

\*\*URL:\*\* https://heroiclabs.com/docs/satori/guides/server-events/
\*\*Summary:\*\* Guide to use Server-Events API to send events in batch for different identities, without identity id and session id.
\*\*Keywords:\*\* how to send server-side analytic events, satori, server events
\*\*Categories:\*\* satori, server-events, guides

\-\-\-

\# How to Send Server-Side Analytic Events

Sending server-side analytic events is a key use case for understanding player behavior. Whether you prefer to centralize event processing on your server or send events that are not directly tied to player actions (such as the end of a match or updates in shared gameplay), server-side events help you better understand your players. In this guide, you will learn how to send server-side events using the Server-Event API of Satori.

\## Using the Server-Event API
Satori's Server-Event API provides a flexible approach to Satori's event ingestion.

Using the Satori client SDK or Nakama's \`satori.EventsPublish\` function, you can send events for a single identity. In contrast, the Server-Event API is capable of accepting events for different identities and can ingest events from different identities as a batch. To provide this capability, the API uses a different authorization method.

The \`Server-Events\` endpoint is \`v1/server-event\`. To send events using this API, the full URL you need to call is:

\`<>/v1/server-event\`

Now, let's deep dive on how to use this API.

\### Authorization
The Server Event API - unlike other Client SDKs or Console APIs - authenticates using the "API Key" from your Satori server. "API Keys" are located under the "Settings" page in your Satori Dashboard.

You can use any existing API Key or create a new key to use for Server-Event API authentication. We recommend using different API Keys for each event source so you can also differentiate if needed in your data lake exports.

To authorize your Server-Event API requests, use "Basic Auth" where the username is your API Key and the password is empty.

\### Sending Events
The Server-Event API expects to have an array of events under the \`events\` object in the request body. A sample of two events can be found below.

\`\`\`json
{
 "events":
 \[\
 {\
 "name": "purchaseCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "",\
 "metadata": {\
 "test": "false",\
 "amount": "20",\
 "currency": "GBP"\
 }\
 },\
 {\
 "name": "packageDropped",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "3",\
 "metadata": {\
 "matchId": "C5B60A25-66E3-4924-B462-9B7E380B1E0D",\
 "dropNumber": "3"\
 }\
 }\
 \]
}
\`\`\`

You can find all the possible fields in an event and their details in the table below.

\| Field Name \| Type \| Format \| Required \| Description \|
\|-----------------------\|---------\|------------\|----------\|-----------------------------------------------------------------------------------------------------------------------------------------------------\|
\| \`name\` \| string \| – \| Yes \| Event name. \|
\| \`id\` \| string \| – \| No \| Optional event ID assigned by the client, used to de-duplicate in retransmission scenarios. If not supplied, the server assigns a unique ID. \|
\| \`metadata\` \| object \| – \| No \| Event metadata, if any. Keys and values are strings. \|
\| \`value\` \| string \| – \| No \| Optional value. \|
\| \`timestamp\` \| string \| date-time \| Yes \| The time when the event was triggered on the producer side. \|
\| \`identity\_id\` \| string \| – \| No \| The identity ID associated with the event. \|
\| \`session\_id\` \| string \| – \| No \| The session ID associated with the event. \|
\| \`session\_issued\_at\` \| string \| int64 \| No \| The session "issued at" timestamp. \|
\| \`session\_expires\_at\` \| string \| int64 \| No \| The session "expires at" timestamp. \|

The main advantage of the Server-Event API is its ability to accept events from different users. Because it is designed for triggering events from a server, it allows you to add events from different identities in the same request.

\### Batch Events Acceptance Behavior
When events are sent in a batch, each event is evaluated independently. A batch is not accepted or rejected as a single unit. This means valid events in the same batch can still be accepted even if other events are rejected. Rejected events can be reviewed in the debugger.

\## Use Cases

In addition to supporting multiple identities, the Server-Event API offers several other use cases that can enhance event collection for your game. These are also available when you use other event publishing methods, however, this guide will focus on how they can be useful with the Server-Event API.

\### Sending Events without an Identity (Non-Player Events)
Satori allows events to be ingested without any identity. Those events are named Non-Player Events and are great to use for events related to a group, game, or match rather than a player. For example, a package drop in a large-scale multiplayer game (like Fortnite) is a non-player event.

Non-player events are stored in Satori and are used to update metrics. However, the events are not listed under any identities as they are not bound to an identity. Instead, those events are passed to data lake adaptors and will be available for you to access from the data lake's portal.

\### Sending Events without a Session
Satori - regardless of the source of the event - matches events with the most relevant session ID if an event is sent without any session information. Although this behavior is not specific to the Server-Event API, it is very useful when you are sending events from a server. If you are sending events from both the clients and the server for players, this behaviour of Satori will help a lot in terms of managing sessions.

Regardless of where you create the session, if you use the Server-Event API to send an event without \`sessionId\`, Satori will automatically match it with the most recently created session.

\## Examples

In this section, you will see how to send different events for different use cases.

First, let's start with a \`purchaseCompleted\` event which is sent for a specific user when an in-app purchase is validated by the store:

\`\`\`json
{
 "events":
 \[\
 {\
 "name": "purchaseCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "",\
 "metadata": {\
 "test": "false",\
 "amount": "20",\
 "currency": "GBP"\
 }\
 }\
 \]
}
\`\`\`

Because this event does not have any session information, when it is received by Satori, it will automatically be linked to the latest available session if it is within the configured period by \`event.sessionless\_events\_grace\_period\_sec\`.

Now, let's see an event that is sent during a match. Let's assume that the game is a co-op multiplayer shooter game and there is a new enemy spawned for that game instance:

\`\`\`json
{
 "events":
 \[\
 {\
 "name": "enemySpawned",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "5",\
 "metadata": {\
 "matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",\
 "partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",\
 "spawnCount": "5",\
 "gameTimeSec": "528"\
 }\
 }\
 \]
}
\`\`\`

This event has no identity set. The system will not make this event bound to any identity, and it will be forwarded to the configured data lake for storage and analysis.

Finally, let's send a custom event named \`levelCompleted\`. This time, let's also send the event with a session ID.

\`\`\`json
{
 "events":
 \[\
 {\
 "name": "levelCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",\
 "sessionIssuedAt": "1752577200",\
 "sessionExpiresAt": "1752663600",\
 "value": "10",\
 "metadata": {\
 "levelId": "10",\
 "retryCount": "2"\
 }\
 }\
 \]
}
\`\`\`

When you send an event with a \`sessionID\`, Satori will use this session ID and its "Issued At" and "Expires At" attributes will be displayed in the event under the Satori dashboard. This gives you the option to manage the session IDs yourself instead of using the latest Satori session.

\## Code Samples

In this section you will find code samples that demonstrate how to send server events.

The following curl command will send the three events described above. Please remember to replace \`\` with your server URL and "" with your actual API Key.

\`\`\`bash
curl --location '/v1/server-event' \
--user ':' \
--header 'Content-Type: application/json' \
--data '{
 "events":
 \[\
 {\
 "name": "purchaseCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "",\
 "metadata": {\
 "test": "false",\
 "amount": "20",\
 "currency": "GBP"\
 }\
 },\
 {\
 "name": "enemySpawned",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "5",\
 "metadata": {\
 "matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",\
 "partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",\
 "spawnCount": "5",\
 "gameTimeSec": "528"\
 }\
 },\
 {\
 "name": "levelCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",\
 "sessionIssuedAt": "1752577200",\
 "sessionExpiresAt": "1752663600",\
 "value": "10",\
 "metadata": {\
 "levelId": "10",\
 "retryCount": "2"\
 }\
 }\
 \]
}'
\`\`\`

The code snippets below show how to send server events in your preferred language (you can select a different language using the dropdown at the top of the page).

{{< code type="server">}}
\`\`\`go
package main

import (
 "bytes"
 "encoding/base64"
 "fmt"
 "net/http"
)

func main() {
 url := "http:///v1/server-event"
 username := ""
 password := ""

 auth := base64.StdEncoding.EncodeToString(\[\]byte(username + ":" + password))
 jsonData := \[\]byte(\`{
 "events": \[\
 {\
 "name": "purchaseCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "",\
 "metadata": {\
 "test": "false",\
 "amount": "20",\
 "currency": "GBP"\
 }\
 },\
 {\
 "name": "enemySpawned",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "5",\
 "metadata": {\
 "matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",\
 "partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",\
 "spawnCount": "5",\
 "gameTimeSec": "528"\
 }\
 },\
 {\
 "name": "levelCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",\
 "sessionIssuedAt": "1752577200",\
 "sessionExpiresAt": "1752663600",\
 "value": "10",\
 "metadata": {\
 "levelId": "10",\
 "retryCount": "2"\
 }\
 }\
 \]
 }\`)

 req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
 if err != nil {
 panic(err)
 }
 req.Header.Set("Content-Type", "application/json")
 req.Header.Set("Authorization", "Basic "+auth)

 client := &http.Client{}
 resp, err := client.Do(req)
 if err != nil {
 panic(err)
 }
 defer resp.Body.Close()

 fmt.Println("Response Status:", resp.Status)
}
\`\`\`
{{< / code >}}

{{< code type="server">}}
\`\`\`lua
local http = require("socket.http")
local ltn12 = require("ltn12")
local mime = require("mime") -- Ensure LuaSocket supports this

local username = ""
local password = ""
local auth = mime.b64(username .. ":" .. password)

local json = \[\[\
{\
 "events": \[\
 {\
 "name": "purchaseCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "",\
 "metadata": { "test": "false", "amount": "20", "currency": "GBP" }\
 },\
 {\
 "name": "enemySpawned",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "value": "5",\
 "metadata": {\
 "matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",\
 "partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",\
 "spawnCount": "5",\
 "gameTimeSec": "528"\
 }\
 },\
 {\
 "name": "levelCompleted",\
 "identityId": "00000000-0000-0000-0000-000000000001",\
 "timestamp": "2025-07-15T12:00:00.00Z",\
 "sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",\
 "sessionIssuedAt": "1752577200",\
 "sessionExpiresAt": "1752663600",\
 "value": "10",\
 "metadata": { "levelId": "10", "retryCount": "2" }\
 }\
 \]\
}\
\]\]

local response = {}
local res, code, headers, status = http.request{
 url = "http:///v1/server-event",
 method = "POST",
 headers = {
 \["Authorization"\] = "Basic " .. auth,
 \["Content-Type"\] = "application/json",
 \["Content-Length"\] = tostring(#json)
 },
 source = ltn12.source.string(json),
 sink = ltn12.sink.table(response)
}

print("Status:", status)
print("Response body:", table.concat(response))
\`\`\`
{{< / code >}}

{{< code type="server">}}
\`\`\`typescript
const fetch = require("node-fetch"); // Only needed in Node.js

const username = "";
const password = "";

const auth = Buffer.from(\`${username}:${password}\`).toString("base64");

const body = {
 events: \[\
 {\
 name: "purchaseCompleted",\
 identityId: "00000000-0000-0000-0000-000000000001",\
 timestamp: "2025-07-15T12:00:00.00Z",\
 value: "",\
 metadata: {\
 test: "false",\
 amount: "20",\
 currency: "GBP"\
 }\
 },\
 {\
 name: "enemySpawned",\
 timestamp: "2025-07-15T12:00:00.00Z",\
 value: "5",\
 metadata: {\
 matchId: "0078EC13-FDE4-44E7-990C-3ABE180B6298",\
 partyId: "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",\
 spawnCount: "5",\
 gameTimeSec: "528"\
 }\
 },\
 {\
 name: "levelCompleted",\
 identityId: "00000000-0000-0000-0000-000000000001",\
 timestamp: "2025-07-15T12:00:00.00Z",\
 sessionId: "2513FC77-3B8D-487B-9709-18E0A27F0ECB",\
 sessionIssuedAt: "1752577200",\
 sessionExpiresAt: "1752663600",\
 value: "10",\
 metadata: {\
 levelId: "10",\
 retryCount: "2"\
 }\
 }\
 \]
};

fetch("http:///v1/server-event", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 "Authorization": \`Basic ${auth}\`
 },
 body: JSON.stringify(body)
})
 .then(res => res.text())
 .then(text => console.log("Response:", text))
 .catch(err => console.error("Error:", err));
\`\`\`
{{< / code >}}

\## Conclusion
Satori provides a wide range of options to send events from your game clients, Nakama, and other servers. The Server-Event API is a simple and effective way to send batch events for multiple identities — with or without session information — including non-player events from your server. It's flexibility makes it ideal for integrating both player-specific and non-player events across your backend systems, while ensuring accurate session mapping.

\## Related Resources

\- \[Sessions concept guide\](../../concepts/performance-monitoring/manage-sessions/)
\- \[Identity Events concept guide\](../../concepts/performance-monitoring/understand-events/)
\- \[How to use Satori for Effective Session Management\](../session-management)