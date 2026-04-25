import { useRef, useState, useCallback, useEffect } from "react";
import { useAuthStore, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_USE_SSL } from "@nakama/shared";
import type {
  Channel,
  ChannelMessage,
  ChannelPresenceEvent,
} from "@nakama/shared";

type MessageHandler = (msg: ChannelMessage) => void;
type PresenceHandler = (evt: ChannelPresenceEvent) => void;

interface PendingJoin {
  resolve: (ch: Channel) => void;
  reject: (err: Error) => void;
}

export function useNakamaSocket() {
  const token = useAuthStore((s) => s.token);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const messageHandlersRef = useRef<Set<MessageHandler>>(new Set());
  const presenceHandlersRef = useRef<Set<PresenceHandler>>(new Set());
  const pendingJoinsRef = useRef<Map<number, PendingJoin>>(new Map());
  const cidCounterRef = useRef(1);

  useEffect(() => {
    if (!token) return;

    const protocol = NAKAMA_USE_SSL ? "wss" : "ws";
    const url = `${protocol}://${NAKAMA_HOST}:${NAKAMA_PORT}/ws?lang=en&status=true&token=${encodeURIComponent(token)}&format=json`;
    let shouldReconnect = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function doConnect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onclose = () => {
        setConnected(false);
        if (shouldReconnect) {
          reconnectTimer = setTimeout(doConnect, 3000);
        }
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);

          if (data.channel) {
            const cid = data.cid ? Number(data.cid) : 0;
            const pending = pendingJoinsRef.current.get(cid);
            if (pending) {
              pending.resolve(data.channel as Channel);
              pendingJoinsRef.current.delete(cid);
            }
          }

          if (data.channel_message) {
            for (const h of messageHandlersRef.current) {
              h(data.channel_message as ChannelMessage);
            }
          }

          if (data.channel_presence_event) {
            for (const h of presenceHandlersRef.current) {
              h(data.channel_presence_event as ChannelPresenceEvent);
            }
          }

          if (data.error) {
            const cid = data.cid ? Number(data.cid) : 0;
            const pending = pendingJoinsRef.current.get(cid);
            if (pending) {
              pending.reject(
                new Error(data.error.message || "Channel join failed"),
              );
              pendingJoinsRef.current.delete(cid);
            }
          }
        } catch {
          /* ignore parse errors */
        }
      };
    }

    doConnect();

    return () => {
      shouldReconnect = false;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      for (const [, pending] of pendingJoinsRef.current) {
        pending.reject(new Error("Disconnected"));
      }
      pendingJoinsRef.current.clear();
    };
  }, [token]);

  const joinChannel = useCallback(
    (
      target: string,
      type: number,
      persistence = true,
      hidden = false,
    ): Promise<Channel> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket not connected"));
          return;
        }
        const cid = cidCounterRef.current++;
        pendingJoinsRef.current.set(cid, { resolve, reject });
        ws.send(
          JSON.stringify({
            cid: String(cid),
            channel_join: { target, type, persistence, hidden },
          }),
        );
      });
    },
    [],
  );

  const leaveChannel = useCallback((channelId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const cid = cidCounterRef.current++;
    ws.send(
      JSON.stringify({
        cid: String(cid),
        channel_leave: { channel_id: channelId },
      }),
    );
  }, []);

  const sendMessage = useCallback(
    (channelId: string, content: Record<string, unknown>) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const cid = cidCounterRef.current++;
      ws.send(
        JSON.stringify({
          cid: String(cid),
          channel_message_send: {
            channel_id: channelId,
            content: JSON.stringify(content),
          },
        }),
      );
    },
    [],
  );

  const onMessage = useCallback((handler: MessageHandler) => {
    messageHandlersRef.current.add(handler);
    return () => {
      messageHandlersRef.current.delete(handler);
    };
  }, []);

  const onPresence = useCallback((handler: PresenceHandler) => {
    presenceHandlersRef.current.add(handler);
    return () => {
      presenceHandlersRef.current.delete(handler);
    };
  }, []);

  return {
    connected,
    joinChannel,
    leaveChannel,
    sendMessage,
    onMessage,
    onPresence,
  };
}
