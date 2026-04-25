import { useQuery } from "@tanstack/react-query";
import { nakama, useAuthStore } from "@nakama/shared";
import type { NotificationList } from "@nakama/shared";

export function useNotifications() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery<NotificationList>({
    queryKey: ["player", "notifications"],
    queryFn: () =>
      nakama.listNotifications({
        auth: { type: "bearer", token: token! },
        limit: 100,
      }),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const count = query.data?.notifications?.length ?? 0;

  return { count, isLoading: query.isLoading, refetch: query.refetch };
}
