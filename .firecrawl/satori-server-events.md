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

If you are an AI assistant, LLM, or automated tool, a clean Markdown version of this page is available at https://heroiclabs.com/docs/satori/guides/server-events/llm.md — optimized for AI and LLM tools.

- [Personalized Content](https://heroiclabs.com/docs/satori/guides/personalization/)
- [Targeting Lapsed Spenders](https://heroiclabs.com/docs/satori/guides/target-lapsed-spenders/)
- [Return incentives](https://heroiclabs.com/docs/satori/guides/return-incentives/)
- [How to Use Satori & Databricks to Predict and Prevent Player Churn](https://heroiclabs.com/docs/satori/guides/satori-databricks/)
- [How to use Satori for Effective Session Management](https://heroiclabs.com/docs/satori/guides/session-management/)
- [How to Send Server-Side Analytic Events](https://heroiclabs.com/docs/satori/guides/server-events/)
- [How to debug invalid analytic events](https://heroiclabs.com/docs/satori/guides/debug-invalid-events/)

Client.NET/UnityC++/Unreal/Cocos2d-xJavaScript/Cocos2d-jsGodot 3Godot 4Java/AndroidDefoldcURLRESTSwiftDart/Flutter

ServerTypeScriptGoLua

Copy for LLM· [View as Markdown](https://heroiclabs.com/docs/satori/guides/server-events/llm.md "View this page as raw Markdown")

# How to Send Server-Side Analytic Events

Sending server-side analytic events is a key use case for understanding player behavior. Whether you prefer to centralize event processing on your server or send events that are not directly tied to player actions (such as the end of a match or updates in shared gameplay), server-side events help you better understand your players. In this guide, you will learn how to send server-side events using the Server-Event API of Satori.

## Using the Server-Event API [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#using-the-server-event-api)

Satori’s Server-Event API provides a flexible approach to Satori’s event ingestion.

Using the Satori client SDK or Nakama’s `satori.EventsPublish` function, you can send events for a single identity. In contrast, the Server-Event API is capable of accepting events for different identities and can ingest events from different identities as a batch. To provide this capability, the API uses a different authorization method.

The `Server-Events` endpoint is `v1/server-event`. To send events using this API, the full URL you need to call is:

`<<your-satori-server-url>>/v1/server-event`

Now, let’s deep dive on how to use this API.

### Authorization [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#authorization)

The Server Event API - unlike other Client SDKs or Console APIs - authenticates using the “API Key” from your Satori server. “API Keys” are located under the “Settings” page in your Satori Dashboard.

You can use any existing API Key or create a new key to use for Server-Event API authentication. We recommend using different API Keys for each event source so you can also differentiate if needed in your data lake exports.

To authorize your Server-Event API requests, use “Basic Auth” where the username is your API Key and the password is empty.

### Sending Events [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#sending-events)

The Server-Event API expects to have an array of events under the `events` object in the request body. A sample of two events can be found below.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>``` | ```json<br>{<br>    "events":<br>    [<br>        {<br>            "name": "purchaseCompleted",<br>            "identityId": "00000000-0000-0000-0000-000000000001",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "value": "",<br>            "metadata": {<br>                "test": "false",<br>                "amount": "20",<br>                "currency": "GBP"<br>           }<br>        },<br>        {<br>            "name": "packageDropped",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "value": "3",<br>            "metadata": {<br>                "matchId": "C5B60A25-66E3-4924-B462-9B7E380B1E0D",<br>                "dropNumber": "3"<br>            }<br>        }<br>    ]<br>}<br>``` |

You can find all the possible fields in an event and their details in the table below.

| Field Name | Type | Format | Required | Description |
| --- | --- | --- | --- | --- |
| `name` | string | – | Yes | Event name. |
| `id` | string | – | No | Optional event ID assigned by the client, used to de-duplicate in retransmission scenarios. If not supplied, the server assigns a unique ID. |
| `metadata` | object | – | No | Event metadata, if any. Keys and values are strings. |
| `value` | string | – | No | Optional value. |
| `timestamp` | string | date-time | Yes | The time when the event was triggered on the producer side. |
| `identity_id` | string | – | No | The identity ID associated with the event. |
| `session_id` | string | – | No | The session ID associated with the event. |
| `session_issued_at` | string | int64 | No | The session “issued at” timestamp. |
| `session_expires_at` | string | int64 | No | The session “expires at” timestamp. |

The main advantage of the Server-Event API is its ability to accept events from different users. Because it is designed for triggering events from a server, it allows you to add events from different identities in the same request.

### Batch Events Acceptance Behavior [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#batch-events-acceptance-behavior)

When events are sent in a batch, each event is evaluated independently. A batch is not accepted or rejected as a single unit. This means valid events in the same batch can still be accepted even if other events are rejected. Rejected events can be reviewed in the debugger.

## Use Cases [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#use-cases)

In addition to supporting multiple identities, the Server-Event API offers several other use cases that can enhance event collection for your game. These are also available when you use other event publishing methods, however, this guide will focus on how they can be useful with the Server-Event API.

### Sending Events without an Identity (Non-Player Events) [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#sending-events-without-an-identity-non-player-events)

Satori allows events to be ingested without any identity. Those events are named Non-Player Events and are great to use for events related to a group, game, or match rather than a player. For example, a package drop in a large-scale multiplayer game (like Fortnite) is a non-player event.

Non-player events are stored in Satori and are used to update metrics. However, the events are not listed under any identities as they are not bound to an identity. Instead, those events are passed to data lake adaptors and will be available for you to access from the data lake’s portal.

### Sending Events without a Session [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#sending-events-without-a-session)

Satori - regardless of the source of the event - matches events with the most relevant session ID if an event is sent without any session information. Although this behavior is not specific to the Server-Event API, it is very useful when you are sending events from a server. If you are sending events from both the clients and the server for players, this behaviour of Satori will help a lot in terms of managing sessions.

Regardless of where you create the session, if you use the Server-Event API to send an event without `sessionId`, Satori will automatically match it with the most recently created session.

## Examples [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#examples)

In this section, you will see how to send different events for different use cases.

First, let’s start with a `purchaseCompleted` event which is sent for a specific user when an in-app purchase is validated by the store:

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>``` | ```json<br>{<br>    "events":<br>    [<br>        {<br>            "name": "purchaseCompleted",<br>            "identityId": "00000000-0000-0000-0000-000000000001",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "value": "",<br>            "metadata": {<br>                "test": "false",<br>                "amount": "20",<br>                "currency": "GBP"<br>           }<br>        }<br>    ]<br>}<br>``` |

Because this event does not have any session information, when it is received by Satori, it will automatically be linked to the latest available session if it is within the configured period by `event.sessionless_events_grace_period_sec`.

Now, let’s see an event that is sent during a match. Let’s assume that the game is a co-op multiplayer shooter game and there is a new enemy spawned for that game instance:

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>``` | ```json<br>{<br>    "events":<br>    [<br>        {<br>            "name": "enemySpawned",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "value": "5",<br>            "metadata": {<br>                "matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",<br>                "partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",<br>                "spawnCount": "5",<br>                "gameTimeSec": "528"<br>           }<br>        }<br>    ]<br>}<br>``` |

This event has no identity set. The system will not make this event bound to any identity, and it will be forwarded to the configured data lake for storage and analysis.

Finally, let’s send a custom event named `levelCompleted`. This time, let’s also send the event with a session ID.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>``` | ```json<br>{<br>    "events": <br>    [<br>        {<br>            "name": "levelCompleted",<br>            "identityId": "00000000-0000-0000-0000-000000000001",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",<br>            "sessionIssuedAt": "1752577200",<br>            "sessionExpiresAt": "1752663600",  <br>            "value": "10",<br>            "metadata": {<br>                "levelId": "10",<br>                "retryCount": "2"<br>           }<br>        }<br>    ]<br>}<br>``` |

When you send an event with a `sessionID`, Satori will use this session ID and its “Issued At” and “Expires At” attributes will be displayed in the event under the Satori dashboard. This gives you the option to manage the session IDs yourself instead of using the latest Satori session.

## Code Samples [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#code-samples)

In this section you will find code samples that demonstrate how to send server events.

The following curl command will send the three events described above. Please remember to replace `<your-satori-server>` with your server URL and “” with your actual API Key.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>35<br>36<br>37<br>38<br>39<br>40<br>41<br>42<br>43<br>``` | ```bash<br>curl --location '<your-satori-server>/v1/server-event' \<br>--user '<your-api-key>:' \<br>--header 'Content-Type: application/json' \<br>--data '{<br>    "events":<br>    [<br>        {<br>            "name": "purchaseCompleted",<br>            "identityId": "00000000-0000-0000-0000-000000000001",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "value": "",<br>            "metadata": {<br>                "test": "false",<br>                "amount": "20",<br>                "currency": "GBP"<br>           }<br>        },<br>        {<br>            "name": "enemySpawned",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "value": "5",<br>            "metadata": {<br>                "matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",<br>                "partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",<br>                "spawnCount": "5",<br>                "gameTimeSec": "528"<br>           }<br>        },<br>        {<br>            "name": "levelCompleted",<br>            "identityId": "00000000-0000-0000-0000-000000000001",<br>            "timestamp": "2025-07-15T12:00:00.00Z",<br>            "sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",<br>            "sessionIssuedAt": "1752577200",<br>            "sessionExpiresAt": "1752663600",  <br>            "value": "10",<br>            "metadata": {<br>                "levelId": "10",<br>                "retryCount": "2"<br>           }<br>        }        <br>    ]<br>}'<br>``` |

The code snippets below show how to send server events in your preferred language (you can select a different language using the dropdown at the top of the page).

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>35<br>36<br>37<br>38<br>39<br>40<br>41<br>42<br>43<br>44<br>45<br>46<br>47<br>48<br>49<br>50<br>51<br>52<br>53<br>54<br>55<br>56<br>57<br>58<br>59<br>60<br>61<br>62<br>63<br>64<br>65<br>66<br>67<br>68<br>69<br>70<br>71<br>``` | ```go<br>package main<br>import (<br>	"bytes"<br>	"encoding/base64"<br>	"fmt"<br>	"net/http"<br>)<br>func main() {<br>	url := "http://<your-satori-server>/v1/server-event"<br>	username := "<your-api-key>"<br>	password := ""<br>	auth := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))<br>	jsonData := []byte(`{<br>		"events": [<br>			{<br>				"name": "purchaseCompleted",<br>				"identityId": "00000000-0000-0000-0000-000000000001",<br>				"timestamp": "2025-07-15T12:00:00.00Z",<br>				"value": "",<br>				"metadata": {<br>					"test": "false",<br>					"amount": "20",<br>					"currency": "GBP"<br>				}<br>			},<br>			{<br>				"name": "enemySpawned",<br>				"timestamp": "2025-07-15T12:00:00.00Z",<br>				"value": "5",<br>				"metadata": {<br>					"matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",<br>					"partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",<br>					"spawnCount": "5",<br>					"gameTimeSec": "528"<br>				}<br>			},<br>			{<br>				"name": "levelCompleted",<br>				"identityId": "00000000-0000-0000-0000-000000000001",<br>				"timestamp": "2025-07-15T12:00:00.00Z",<br>				"sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",<br>				"sessionIssuedAt": "1752577200",<br>				"sessionExpiresAt": "1752663600",<br>				"value": "10",<br>				"metadata": {<br>					"levelId": "10",<br>					"retryCount": "2"<br>				}<br>			}<br>		]<br>	}`)<br>	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))<br>	if err != nil {<br>		panic(err)<br>	}<br>	req.Header.Set("Content-Type", "application/json")<br>	req.Header.Set("Authorization", "Basic "+auth)<br>	client := &http.Client{}<br>	resp, err := client.Do(req)<br>	if err != nil {<br>		panic(err)<br>	}<br>	defer resp.Body.Close()<br>	fmt.Println("Response Status:", resp.Status)<br>}<br>``` |

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>35<br>36<br>37<br>38<br>39<br>40<br>41<br>42<br>43<br>44<br>45<br>46<br>47<br>48<br>49<br>50<br>51<br>52<br>53<br>54<br>55<br>56<br>57<br>58<br>``` | ```lua<br>local http = require("socket.http")<br>local ltn12 = require("ltn12")<br>local mime = require("mime")  -- Ensure LuaSocket supports this<br>local username = "<your-api-key>"<br>local password = ""<br>local auth = mime.b64(username .. ":" .. password)<br>local json = [[<br>{<br>	"events": [<br>		{<br>			"name": "purchaseCompleted",<br>			"identityId": "00000000-0000-0000-0000-000000000001",<br>			"timestamp": "2025-07-15T12:00:00.00Z",<br>			"value": "",<br>			"metadata": { "test": "false", "amount": "20", "currency": "GBP" }<br>		},<br>		{<br>			"name": "enemySpawned",<br>			"timestamp": "2025-07-15T12:00:00.00Z",<br>			"value": "5",<br>			"metadata": {<br>				"matchId": "0078EC13-FDE4-44E7-990C-3ABE180B6298",<br>				"partyId": "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",<br>				"spawnCount": "5",<br>				"gameTimeSec": "528"<br>			}<br>		},<br>		{<br>			"name": "levelCompleted",<br>			"identityId": "00000000-0000-0000-0000-000000000001",<br>			"timestamp": "2025-07-15T12:00:00.00Z",<br>			"sessionId": "2513FC77-3B8D-487B-9709-18E0A27F0ECB",<br>			"sessionIssuedAt": "1752577200",<br>			"sessionExpiresAt": "1752663600",<br>			"value": "10",<br>			"metadata": { "levelId": "10", "retryCount": "2" }<br>		}<br>	]<br>}<br>]]<br>local response = {}<br>local res, code, headers, status = http.request{<br>	url = "http://<your-satori-server>/v1/server-event",<br>	method = "POST",<br>	headers = {<br>		["Authorization"] = "Basic " .. auth,<br>		["Content-Type"] = "application/json",<br>		["Content-Length"] = tostring(#json)<br>	},<br>	source = ltn12.source.string(json),<br>	sink = ltn12.sink.table(response)<br>}<br>print("Status:", status)<br>print("Response body:", table.concat(response))<br>``` |

Server

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>35<br>36<br>37<br>38<br>39<br>40<br>41<br>42<br>43<br>44<br>45<br>46<br>47<br>48<br>49<br>50<br>51<br>52<br>53<br>54<br>55<br>56<br>57<br>58<br>``` | ```typescript<br>const fetch = require("node-fetch"); // Only needed in Node.js<br>const username = "<your-api-key>";<br>const password = "";<br>const auth = Buffer.from(`${username}:${password}`).toString("base64");<br>const body = {<br>  events: [<br>    {<br>      name: "purchaseCompleted",<br>      identityId: "00000000-0000-0000-0000-000000000001",<br>      timestamp: "2025-07-15T12:00:00.00Z",<br>      value: "",<br>      metadata: {<br>        test: "false",<br>        amount: "20",<br>        currency: "GBP"<br>      }<br>    },<br>    {<br>      name: "enemySpawned",<br>      timestamp: "2025-07-15T12:00:00.00Z",<br>      value: "5",<br>      metadata: {<br>        matchId: "0078EC13-FDE4-44E7-990C-3ABE180B6298",<br>        partyId: "8D47AF50-8EAF-4C2E-B721-D39A06F9F5E3",<br>        spawnCount: "5",<br>        gameTimeSec: "528"<br>      }<br>    },<br>    {<br>      name: "levelCompleted",<br>      identityId: "00000000-0000-0000-0000-000000000001",<br>      timestamp: "2025-07-15T12:00:00.00Z",<br>      sessionId: "2513FC77-3B8D-487B-9709-18E0A27F0ECB",<br>      sessionIssuedAt: "1752577200",<br>      sessionExpiresAt: "1752663600",<br>      value: "10",<br>      metadata: {<br>        levelId: "10",<br>        retryCount: "2"<br>      }<br>    }<br>  ]<br>};<br>fetch("http://<your-satori-server>/v1/server-event", {<br>  method: "POST",<br>  headers: {<br>    "Content-Type": "application/json",<br>    "Authorization": `Basic ${auth}`<br>  },<br>  body: JSON.stringify(body)<br>})<br>  .then(res => res.text())<br>  .then(text => console.log("Response:", text))<br>  .catch(err => console.error("Error:", err));<br>``` |

## Conclusion [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#conclusion)

Satori provides a wide range of options to send events from your game clients, Nakama, and other servers. The Server-Event API is a simple and effective way to send batch events for multiple identities — with or without session information — including non-player events from your server. It’s flexibility makes it ideal for integrating both player-specific and non-player events across your backend systems, while ensuring accurate session mapping.

## Related Resources [\#](https://heroiclabs.com/docs/satori/guides/server-events/\#related-resources)

- [Sessions concept guide](https://heroiclabs.com/docs/satori/concepts/performance-monitoring/manage-sessions/)
- [Identity Events concept guide](https://heroiclabs.com/docs/satori/concepts/performance-monitoring/understand-events/)
- [How to use Satori for Effective Session Management](https://heroiclabs.com/docs/satori/guides/session-management/)

### Table of Contents

![](https://static.scarf.sh/a.png?x-pxid=1da8b90e-af22-4287-a7c8-aa5b94ea6e71)