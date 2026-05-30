Build **multi-modal** AI applications using our new open-source **[Vision AI SDK](https://visionagents.ai/)**.

# What Causes Message Latency Spikes in Mobile In-App Chat Systems?

[Product](https://getstream.io/blog/topic/product/)

[FAQs](https://getstream.io/blog/topic/product/resources/faqs/)

[Resources](https://getstream.io/blog/topic/product/resources/)

7 min read

Why mobile chat messages spike from milliseconds to seconds, and what to do about it.

![Raymond F](https://stream-blog-v2.imgix.net/blog/wp-content/uploads/331dedb882fe7e7489b35356f737575c/Raymond.png?auto=format&auto=compress&w=96&h=96)

Raymond F

Published March 20, 2026

A single chat message traverses DNS resolution, TLS negotiation, WebSocket framing, server-side fan-out, database persistence, push notification relay, client deserialization, local storage, and UI rendering. Any link in that chain can spike from milliseconds to seconds, and the spikes compound unpredictably.

The difference between a [chat system](https://getstream.io/chat/) that feels instant and one that feels broken usually comes down to tail latency at the 99th percentile, where these failures cluster.

This guide breaks down every major cause, organized by the questions developers most commonly ask when debugging latency.

## Why Do Messages Spike When Users Switch Between WiFi and Cellular?

TCP connections are identified by a 4-tuple: source IP, source port, destination IP, destination port. For example, `192.168.1.42:51234` → `35.186.224.12:443` means the connection is bound to your:

- Device's current IP: `192.168.1.42`
- An ephemeral port the OS assigned: `51234`
- The chat server's IP: `35.186.224.12`
- The chat server’s WebSocket port: `443`

When the phone hops from WiFi to cellular, `192.168.1.42` becomes something like `10.48.3.97`, and the entire tuple is invalid. Any IP change (WiFi to cellular, cell tower handoff, or even switching WiFi access points) invalidates the connection. The WebSocket sitting on top of TCP silently dies. Neither the client nor the server may detect the break immediately, so messages sent during this window disappear until a keepalive or a new send triggers timeout detection.

[Network flapping](https://obkio.com/blog/what-is-network-flapping/) at coverage boundaries is the worst case. Each flap queues packets, then bursts them, drops in-flight data that TCP misinterprets as congestion, and triggers congestion-control throttling that further degrades throughput.

[QUIC (HTTP/3)](https://www.cloudflare.com/learning/performance/what-is-http3/) offers a structural solution here. QUIC connections are identified by a connection ID rather than the IP 4-tuple, so they survive IP changes during network transitions. QUIC also eliminates [TCP's head-of-line blocking](https://dev-aditya.medium.com/understanding-head-of-line-blocking-in-http-1-1-and-how-http-2-and-http-3-solve-it-f005e0a0245b), where at 2% packet loss (common on degraded cellular), HTTP/2 over TCP actually performs worse than HTTP/1.1 with parallel connections because a single lost packet blocks all multiplexed streams.

## What Role Does the Cellular Radio Itself Play in Latency?

Even on a stable LTE connection, the radio introduces latency that developers rarely account for. Transitioning from [RRC\_IDLE](https://howltestuffworks.blogspot.com/2019/09/5g-nr-ue-rrc-states-and-state.html) to RRC\_CONNECTED (the radio "waking up" after being put to sleep for battery savings) takes 50-80ms per 3GPP specifications, though real-world delays, including DRX paging cycles, can push this significantly higher. This penalty applies to the first message after any idle period, which is frequent in bursty chat conversations.

TCP's slow-start algorithm compounds the problem: after idle periods, the congestion window resets per [RFC 5681](https://datatracker.ietf.org/doc/html/rfc5681), forcing the connection to ramp throughput from scratch.

[Carrier-grade NAT](https://www.reddit.com/r/networking/comments/xy41wf/difference_between_nat_and_cgnat/) (CGNAT) silently expires persistent connections, too. Measured NAT timeouts on carrier networks vary widely, with UDP mappings expiring in 10-200 seconds and TCP session defaults as high as 30 minutes, with some carriers as aggressive as 4.5 minutes for TCP. When a NAT table entry expires, the next packet from either direction is silently dropped. The server believes the connection is alive. The client believes the connection is alive. Messages just vanish. The industry has settled on [20-30-second keepalive intervals](https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.websocket.defaultkeepaliveinterval) as a practical compromise (Microsoft's WebSocket implementation defaults to 30s, the Python websockets library defaults to 20s), though even this still causes near-continuous radio activity and significant battery drain.

On top of all this, [research across four major US carriers](https://www.researchgate.net/publication/254463847_Understanding_bufferbloat_in_cellular_networks) found that all suffer from bufferbloat. Oversized buffers in cellular infrastructure cause latency spikes of hundreds of milliseconds to multiple seconds. [APNIC research](https://blog.apnic.net/2022/01/26/beyond-bufferbloat-end-to-end-congestion-control-cannot-avoid-latency-spikes/) showed that this is partly fundamental: on networks with rapidly varying capacity, such as 5G and WiFi, latency spikes are unavoidable even with perfect end-to-end congestion control.

## Why Does Reconnection Take So Long After a Dropped Connection?

Every WebSocket reconnection requires a full connection setup sequence:

| Step | Latency |
| --- | --- |
| [DNS resolution](https://www.keycdn.com/support/reduce-dns-lookups) (cold) | 20-120ms, potentially seconds |
| TCP 3-way handshake | [30-70ms on LTE](https://www.robustel.store/blogs/industrial-iot-blog/lte-vs-5g-speeds-performance-real-world-benchmarks-vs-theoretical-limits) (1 RTT) |
| TLS handshake | 1-2 additional RTTs ( [TLS 1.3](https://datatracker.ietf.org/doc/html/rfc8446) vs [TLS 1.2](https://datatracker.ietf.org/doc/html/rfc5246)) |
| [WebSocket HTTP Upgrade](https://datatracker.ietf.org/doc/html/rfc6455) | 1 RTT |
| Application-level auth | Variable |
| **Total** | **200ms to 2+ seconds** |

TLS 1.2 requires 2 RTTs; TLS 1.3 reduces this to 1 RTT. Under normal conditions, a handshake completes in 20-30ms. But during traffic spikes or reconnection storms, [TLS handshake p99 latency can reach 5-8 seconds](https://systemdr.substack.com/p/tls-handshake-latency-when-your-load) due to queueing, and session resumption success rates can drop from 85% to 15% under memory pressure.

### Messages Arriving Out of Order After Reconnection

Reconnection also exposes a message ordering problem that client timestamps can't solve.

A message composed at 10:00:00.450 on one device and a message composed at 10:00:00.490 on another can arrive at the server in either order depending on network conditions, and device clocks can drift by hundreds of milliseconds.

The correct fix is server-assigned sequence numbers: the server issues a monotonically increasing integer to each message at persistence time, and the client sorts and deduplicates by that sequence number rather than by timestamp. On reconnection, the client sends its last known sequence number as a cursor, and the server replays only what was missed.

Without this, users see messages jump around on reconnect, which registers as a stability problem even when every message was technically delivered.

## What Is a Reconnection Storm, and How Does It Cause Latency?

Reconnection storms (the [thundering herd problem](https://en.wikipedia.org/wiki/Thundering_herd_problem)) are among the most catastrophic latency events in chat systems.

A good public postmortem for the _thundering-herd-in-real-life_ comes from [T3 Chat's Convex backend](https://news.convex.dev/how-convex-took-down-t3-chat-june-1-2025-postmortem/) in 2025. A search index compaction invalidated thousands of client subscriptions simultaneously, spiking query load from ~50 queries/second to 20,000+. The client's backoff logic was fatally flawed because it reset exponential backoff to zero upon successful WebSocket connection, even when the server immediately dropped the connection under load. Clients effectively DDoS'd their own backend for approximately 3 hours.

[Basecamp's Action Cable](https://github.com/rails/rails/pull/40229) faced similar issues with 200,000+ WebSocket clients during server restarts, resulting in random initial reconnection delays of 6-18 seconds, plus deliberately slow exponential backoff.

**Building your own app?** Get early access to our [Livestream](https://getstream.io/video/livestreaming/) or [Video Calling API](https://getstream.io/video/video-calling/) and launch in days!

The proven pattern for preventing reconnection storms combines several techniques:

- Exponential backoff starting at 500ms-1s with a 30-second cap
- 10-100% random jitter on each delay interval
- Server-initiated graceful draining with randomized reconnect instructions during deployments
- Never resetting backoff on mere TCP connection success without first verifying server health

That last point is the one teams most commonly get wrong.

## How Does Message Fan-Out Cause Server-Side Latency Spikes?

[Message fan-out](https://getstream.io/glossary/fan-out/), delivering a message to every online member of a group or channel, is where server-side latency scales nonlinearly. [Discord found](https://blog.bytebytego.com/p/how-discord-serves-15-million-users) that a 1,000-person guild generates 10x the message volume of a 100-person guild.

Before optimization, guild processes for servers with millions of members stalled for seconds while iterating over members. Their solution was multi-layered:

- Relay processes that split fan-out across BEAM processes handling up to 15,000 users each
- Passive sessions where 90%+ of user-guild connections skip processing until the user actively opens the guild
- Offloading fan-out from guild processes to separate sender processes

When someone [triggers @everyone](https://medium.com/@dhananjayaggarwal6561/how-discord-solved-the-everyone-problem-d9b1d2a52ccc) in a massive server, millions of simultaneous reads for the same message create a "hot partition" that can spike latency from 15ms to ~150ms across the entire database cluster.

## How Can Presence and Typing Indicators Cause Latency Problems?

Presence tracking (online/offline/typing indicators) can consume more bandwidth than actual messages. During a scaling crisis, one chat service had to [temporarily disable typing indicators](https://status.stoat.chat/incidents/229376) and user update events entirely to restore service.

[Slack's approach](https://slack.engineering/real-time-messaging/) is more surgical: clients receive presence notifications only for the subset of users visible on the current screen, dramatically reducing fan-out. Typing indicators follow a separate, lighter delivery path, are never persisted, and flow directly through the WebSocket/Gateway/Channel Server chain, with an end-to-end latency of approximately 11ms under ideal conditions.

The cost of presence isn't just bandwidth. [PubNub rewrote its Presence service](https://www.pubnub.com/blog/how-we-halved-our-latency-by-rewriting-presence-service-api-in-rust/) from Python to Rust specifically because of latency. The rewrite reduced hereNow p99 from ~1 second to ~200ms (an 80% reduction) while running on 20% of the previous resources.

## How Does Edge Infrastructure Reduce Latency?

Every major chat infrastructure provider has converged on global edge networks as the primary means of optimizing latency. The principle is consistent: keep the lossy, high-latency mobile connection short (to the nearest edge) while using reliable backbone connections for server-to-server communication.

[Stream Chat's edge infrastructure](https://getstream.io/blog/chat-edge-infrastructure/) demonstrates the impact. By terminating TLS at the edge and using persistent multiplexed HTTP/2 connections between edge and origin servers, Stream reduced latency by 2-12x compared to traditional regional infrastructure:

- Amsterdam to Singapore: p99 dropped from 3,112ms to 255ms (~12x reduction)
- Amsterdam to Mumbai: p99 dropped from 2,197ms to 219ms (~10x reduction)
- Amsterdam to US East: p99 dropped from 1,155ms to 359ms (~3x reduction)

Users furthest from the regional data center see the largest gains. [Stream edge servers](https://getstream.io/chat/docs/react/architecture-and-benchmark/) support HTTP/3 and HTTP/2, and handle TLS termination, API authentication, rate limiting, and CORS at the edge. Traffic between edges and origin servers remains fully encrypted over long-lived HTTP/2 connections, avoiding the security trade-off some providers make by transmitting plaintext between edges.

The gains from edge infrastructure are large because it directly shortens the most unreliable segment of the path (the mobile connection to the nearest server) while letting the rest of the journey occur over optimized, low-loss backbone links.

## What Language and Runtime Choices Affect the Latency Floor?

Language and runtime choices directly determine the achievable latency floor, primarily through their garbage collection behavior:

- **Discord** migrated from JVM-based Cassandra to C++-based ScyllaDB to [eliminate GC pauses entirely](https://discord.com/blog/how-discord-stores-trillions-of-messages).
- **WhatsApp** uses [Erlang with ~300 bytes per process](https://getstream.io/blog/whatsapp-works/) and microsecond-level routing lookups via in-memory Mnesia tables, achieving same-cluster delivery in single-digit milliseconds.
- **Stream** maintains [under 40ms message send latency](https://getstream.io/blog/scaling-chat-5-million-concurrent-connections/) at 5 million concurrent connections using Go.

GC-free or lightweight GC runtimes eliminate an entire category of tail-latency spikes.

## What’s the Irreducible Latency Floor for Mobile Chat?

The absolute floor is set by physics and radio design:

- **Speed of light**: US-to-Asia round-trip is 150-250ms
- **LTE RRC transition**: ~320ms for radio wake-up after idle
- **TLS reconnection**: 200ms-2s per reconnection event

Above that floor, the largest controllable factors are:

- TLS/reconnection overhead (solvable with edge infrastructure and QUIC)
- Database tail latency (solvable by moving to GC-free runtimes)
- Push notification relay variability (600ms-7s typical, with no full workaround)
- OEM battery optimization (capable of making apps completely unreachable on billions of devices).

The engineering pattern that emerges from every production system is the same: terminate connections at the edge, process messages off the main thread, persist to WAL-mode SQLite in batched transactions, use optimistic UI for perceived-instant delivery, design for reconnection as the normal state rather than the exception, and monitor p99 relentlessly.

Integrating Video with your App?

We've built a Video and Audio solution just for you.

Check out our APIs and SDKs.

[Learn more](https://getstream.io/video/)

Recommended posts

[What Database Architecture Works Best for Real-Time Chat Applications?](https://getstream.io/blog/chat-app-database/) [What Are the Best Tools and Libraries for Building a Discord-Like App?](https://getstream.io/blog/tools-discord-app/) [What Causes Message Latency Spikes in Mobile In-App Chat Systems?](https://getstream.io/blog/mobile-chat-latency-spikes/) [What Are the Pros and Cons of Using a Chat SDK vs. Building Chat In-House with Socket.io or Pusher?](https://getstream.io/blog/stream-vs-socketio-pusher/)

StreamInstall Agent Skill

Install from [skills.sh](https://skills.sh/):

npx skills add GetStream/agent-skills **-s stream**

The fastest way to build with Stream. Start a new project or improve an existing one. Full CLI and documentation integration out of the box.

* * *

Ask your agent:

/stream Build me a Social App with Feeds and Moderation.

/stream Any livestream calls running?