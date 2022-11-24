# Nakama集群功能实现
   在nakama的基础上实现集群,集群分为nakama主服务和微服务两部分, nakama主服务通过memberlist实现节点实现与消息同步, 同时也增加GRPC服务。

   微信服务通过GRPC进行通信，并不同步nakama主服务数据，微服务将通过nakama服务进行调用。

   目前还处于探索与开发阶段,还无法提供与nakama程序的集成例子，后期通过大规模的测试，证明该包的有效性，将提供nakama集成后的程序
