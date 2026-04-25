import { useQuery } from "@tanstack/react-query";
import { nakama, useAuthStore } from "@nakama/shared";
import type { WalletBalance } from "@nakama/shared";

function parseWallet(raw: string | undefined): WalletBalance {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WalletBalance;
  } catch {
    return {};
  }
}

export function useWallet() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery({
    queryKey: ["player", "wallet"],
    queryFn: async () => {
      const account = await nakama.getAccount({
        auth: { type: "bearer", token: token! },
      });
      return parseWallet(account.wallet);
    },
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return {
    wallet: query.data ?? ({} as WalletBalance),
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
