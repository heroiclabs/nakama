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

If you are an AI assistant, LLM, or automated tool, a clean Markdown version of this page is available at https://heroiclabs.com/docs/nakama/getting-started/metrics/llm.md — optimized for AI and LLM tools.

- [Installation](https://heroiclabs.com/docs/nakama/getting-started/install/)
  - [Docker Compose](https://heroiclabs.com/docs/nakama/getting-started/install/docker/)
  - [Windows](https://heroiclabs.com/docs/nakama/getting-started/install/windows/)
  - [macOS Binary](https://heroiclabs.com/docs/nakama/getting-started/install/macos/)
  - [Linux](https://heroiclabs.com/docs/nakama/getting-started/install/linux/)
- [CLI Commands](https://heroiclabs.com/docs/nakama/getting-started/commands/)
- [Configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration/)
  - [Docker Configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration/docker-configuration/)
- [Upgrading](https://heroiclabs.com/docs/nakama/getting-started/upgrade/)
- [Metrics](https://heroiclabs.com/docs/nakama/getting-started/metrics/)
- [Nakama Console](https://heroiclabs.com/docs/nakama/getting-started/console/)
- [Architecture Overview](https://heroiclabs.com/docs/nakama/getting-started/architecture/)
- [Benchmarks](https://heroiclabs.com/docs/nakama/getting-started/benchmarks/)
- [Data Privacy](https://heroiclabs.com/docs/nakama/getting-started/data-privacy/)
- [Release Notes](https://heroiclabs.com/docs/nakama/getting-started/release-notes/)

Client.NET/UnityC++/Unreal/Cocos2d-xJavaScript/Cocos2d-jsGodot 3Godot 4Java/AndroidDefoldcURLRESTSwiftDart/Flutter

ServerTypeScriptGoLua

Copy for LLM· [View as Markdown](https://heroiclabs.com/docs/nakama/getting-started/metrics/llm.md "View this page as raw Markdown")

# Prometheus Metrics

This page provides a reference for the metrics collected by Nakama and available for export to Prometheus.

## Snapshot Metrics [\#](https://heroiclabs.com/docs/nakama/getting-started/metrics/\#snapshot-metrics)

| Name | Type | Description | Usage |
| --- | --- | --- | --- |
| `SnapshotLatencyMs` | Gauge | Average latency of requests in milliseconds over a snapshot period. | Identifying average request time, indicating system performance. |
| `SnapshotRateSec` | Gauge | Number of requests per second in the snapshot interval. | Tracking the request rate, understanding system load. |
| `SnapshotRecvKbSec` | Gauge | Rate of data received in kilobytes per second. | Monitoring incoming traffic rate, bandwidth management, performance tuning. |
| `SnapshotSentKbSec` | Gauge | Rate of data sent in kilobytes per second. | Assessing outgoing traffic, system output performance. |

## API Metrics [\#](https://heroiclabs.com/docs/nakama/getting-started/metrics/\#api-metrics)

| Name | Type | Description | Usage |
| --- | --- | --- | --- |
| `Api` | Counter, Timer | Metrics for API calls: request count, latency, bytes received/sent, errors. | Comprehensive view of API performance and error rates. |
| `ApiRpc` | Counter, Timer | Similar to `Api`, specific to RPC calls with `rpc_id` tagging. | Detailed insights into RPC call performance. |
| `ApiBefore` | Counter, Timer | Metrics for pre-processing phases of API calls. | Analyzing overhead or actions before main API processing. |
| `ApiAfter` | Counter, Timer | Metrics for post-processing phases of API calls. | Understanding post-processing steps in API execution. |

## Message Metrics [\#](https://heroiclabs.com/docs/nakama/getting-started/metrics/\#message-metrics)

| Name | Type | Description | Usage |
| --- | --- | --- | --- |
| `Message` | Counter | Count and size of received messages and error occurrences. | Monitoring volume and health of message traffic. |
| `MessageBytesSent` | Counter | Total bytes sent in messages. | Tracking amount of data sent in messages. |

## Gauge Metrics [\#](https://heroiclabs.com/docs/nakama/getting-started/metrics/\#gauge-metrics)

| Name | Type | Description | Usage |
| --- | --- | --- | --- |
| `GaugeRuntimes` | Gauge | Current value for runtime gauges. | Tracking number of runtime instances. |
| `GaugeLuaRuntimes` | Gauge | Number of Lua runtime VMs. | Lua VM management, resource usage and bottleneck analysis. |
| `GaugeJsRuntimes` | Gauge | Count of JavaScript runtime VMs. | JavaScript VM performance and resource allocation monitoring. |
| `GaugeAuthoritativeMatches` | Gauge | Current count of authoritative matches. | Load balancing and resource allocation for gaming servers. |
| `GaugeSessions` | Gauge | Number of active sessions. | Understanding user engagement and server load. |
| `GaugePresences` | Gauge | Number of user presences. | Tracking active user interactions, real-time features. |
| `GaugeStorageIndexEntries` | Gauge | Count of entries in a specific storage index. | Database performance and index management. |

## Count Metrics [\#](https://heroiclabs.com/docs/nakama/getting-started/metrics/\#count-metrics)

| Name | Type | Description | Usage |
| --- | --- | --- | --- |
| `CountDroppedEvents` | Counter | Increments count of dropped events. | Identifying issues with event handling. |
| `CountWebsocketOpened` | Counter | Number of opened WebSocket connections. | Monitoring WebSocket connection stability and usage. |
| `CountWebsocketClosed` | Counter | Number of closed WebSocket connections. | Analyzing WebSocket disconnections. |
| `StorageWriteRejectCount` | Counter | Count of rejected storage write operations. | Data integrity monitoring, storage operation issues. |

## Custom Metrics [\#](https://heroiclabs.com/docs/nakama/getting-started/metrics/\#custom-metrics)

| Name | Type | Description | Usage |
| --- | --- | --- | --- |
| `CustomCounter` | Counter | Custom counter with specified name and tags. | Tracking specific metrics tailored to application. |
| `CustomGauge` | Gauge | Custom gauge metrics. | Monitoring specific custom application scenarios. |
| `CustomTimer` | Timer | Custom timer metrics. | Measuring specific time-bound operations. |

### Table of Contents

![](https://static.scarf.sh/a.png?x-pxid=3602d586-1eed-4187-aaeb-70b8018034e2)