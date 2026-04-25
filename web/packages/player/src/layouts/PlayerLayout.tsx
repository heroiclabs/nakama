import { Outlet, NavLink, Link } from "react-router-dom";
import {
  Home,
  CalendarClock,
  ShoppingBag,
  Trophy,
  User,
  Bell,
  Coins,
  Gem,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@nakama/shared";
import { useWallet } from "@/hooks/use-wallet";
import { useNotifications } from "@/hooks/use-notifications";

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
}

const BOTTOM_NAV: NavItem[] = [
  { label: "Home", to: "/home", icon: Home },
  { label: "Events", to: "/events", icon: CalendarClock },
  { label: "Store", to: "/store", icon: ShoppingBag },
  { label: "Ranks", to: "/leaderboards", icon: Trophy },
  { label: "Profile", to: "/profile", icon: User },
];

export function PlayerLayout() {
  const user = useAuthStore((s) => s.user);
  const { wallet, isLoading: walletLoading } = useWallet();
  const { count: notifCount } = useNotifications();

  const initial =
    user?.display_name?.charAt(0) ?? user?.username?.charAt(0) ?? "?";

  return (
    <div className="flex h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur">
        <span className="text-sm font-bold tracking-tight text-primary">
          NAKAMA
        </span>

        <div className="flex items-center gap-3">
          {walletLoading ? (
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          ) : (
            <>
              <span className="flex items-center gap-1 text-xs font-medium text-amber-500">
                <Coins size={14} />
                {(wallet.coins ?? 0).toLocaleString()}
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-violet-400">
                <Gem size={14} />
                {(wallet.gems ?? 0).toLocaleString()}
              </span>
            </>
          )}

          <Link
            to="/inbox"
            className="relative p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Bell size={18} />
            {notifCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                {notifCount > 99 ? "99+" : notifCount}
              </span>
            )}
          </Link>

          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold uppercase text-primary-foreground">
            {initial}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>

      <nav className="sticky bottom-0 flex items-center justify-around border-t border-border bg-card py-2">
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 px-3 py-1 text-xs transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
