import { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { serverKeyAuth, satori } from "@nakama/shared";
import {
  Activity,
  Filter,
  CalendarRange,
  FileBarChart,
  Gauge,
  Tags,
  LayoutDashboard,
  Users,
  Puzzle,
  Sparkles,
  Flag,
  CalendarClock,
  FlaskConical,
  UsersRound,
  MessageSquare,
  Shield,
  Tag,
  ScrollText,
  Award,
  Medal,
  Trophy,
  Gift,
  BookMarked,
  Database,
  Gamepad2,
  Terminal,
  Wallet,
  BarChart3,
  Boxes,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/stores/admin-store";
import { useActiveApp } from "@/hooks/useScopedGame";
import { hiddenNavPathsForApp } from "@/config/app-nav-manifest";
import { useAdminAuth } from "@/auth/admin-auth";

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
      { label: "Apps", to: "/apps", icon: Boxes },
      { label: "Timeline", to: "/timeline", icon: CalendarRange },
    ],
  },
  {
    label: "LiveOps",
    items: [
      { label: "Feature Flags", to: "/flags", icon: Flag },
      { label: "Live Events", to: "/events", icon: CalendarClock },
      { label: "Live Event Prizes", to: "/prizes", icon: Gift },
      { label: "Prize Catalog", to: "/prize-catalog", icon: BookMarked },
      { label: "Experiments", to: "/experiments", icon: FlaskConical },
      { label: "Audiences", to: "/audiences", icon: UsersRound },
      { label: "Messages", to: "/messages", icon: MessageSquare },
      { label: "Funnels & Retention", to: "/funnels", icon: Filter },
      { label: "Event Debugger", to: "/event-debugger", icon: Activity },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Metrics", to: "/metrics", icon: Gauge },
      { label: "Onboarding Reports", to: "/reports", icon: FileBarChart },
      { label: "Analytics", to: "/analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Configuration",
    items: [
      { label: "Hiro Config", to: "/hiro-config", icon: Puzzle },
      { label: "Satori Config", to: "/satori-config", icon: Sparkles },
      { label: "Offers", to: "/offers", icon: Tag },
      { label: "Quests Config", to: "/quests-config", icon: ScrollText },
      { label: "Battle Pass Config", to: "/battlepass-config", icon: Award },
      { label: "Achievements", to: "/achievements", icon: Medal },
      { label: "Leaderboards Config", to: "/leaderboards-config", icon: Trophy },
      { label: "Economy", to: "/economy", icon: Wallet },
      { label: "Taxonomy", to: "/taxonomy", icon: Tags },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Players", to: "/players", icon: Users },
      { label: "Accounts", to: "/accounts", icon: Shield },
      { label: "Storage", to: "/storage", icon: Database },
      { label: "Matches", to: "/matches", icon: Gamepad2 },
      { label: "Server Logs", to: "/logs", icon: Terminal },
      { label: "Settings", to: "/settings", icon: Settings },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function getPageTitle(pathname: string) {
  const item = ALL_NAV_ITEMS.find((i) => i.to === pathname);
  return item?.label ?? "Admin Console";
}

function AppSelector() {
  const selectedAppId = useAdminStore((s) => s.selectedAppId);
  const setSelectedAppId = useAdminStore((s) => s.setSelectedAppId);
  const setDefaultAppId = useAdminStore((s) => s.setDefaultAppId);
  const { data: apps } = useQuery({
    queryKey: ["admin", "apps", "selector"],
    queryFn: () => satori.getGameRegistry(serverKeyAuth()),
    select: (d) => d.games ?? [],
    retry: 1,
    staleTime: 60_000,
  });

  const list = apps ?? [];
  const knownIds = new Set(list.map((a) => a.id));

  // First visit with no explicit choice → land on the first registered app so
  // the viewer always sees a concrete, named scope (never bare "All Apps").
  useEffect(() => {
    if (list.length > 0) setDefaultAppId(list[0].id);
  }, [list, setDefaultAppId]);

  return (
    <div className="relative flex items-center">
      <Boxes className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
      <select
        value={selectedAppId}
        onChange={(e) => setSelectedAppId(e.target.value)}
        title="Scope analytics to an app"
        className="h-8 max-w-[180px] cursor-pointer appearance-none truncate rounded-md border border-border bg-background pl-7 pr-7 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus:border-primary"
      >
        <option value="">All Apps (combined)</option>
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.title}
          </option>
        ))}
        {selectedAppId && !knownIds.has(selectedAppId) && (
          <option value={selectedAppId}>{selectedAppId.slice(0, 8)}…</option>
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

const SCROLL_AREA =
  "overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

// Pages that are platform-wide admin tools — the app selector is irrelevant
// on these routes and hiding it avoids misleading "QuizVerse scoped" appearance.
const PLATFORM_ONLY_ROUTES = new Set([
  "/apps",
  "/players",
  "/accounts",
  "/storage",
  "/matches",
  "/logs",
  "/settings",
]);

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { theme, setTheme } = useAdminStore();
  const { session, logout } = useAdminAuth();

  const pageTitle = getPageTitle(location.pathname);
  const activeApp = useActiveApp();
  const showAppSelector = !PLATFORM_ONLY_ROUTES.has(location.pathname);

  // Hide nav items whose backend is hard-wired to a different app than the
  // one currently selected (see app-nav-manifest.ts). "All Apps" and
  // not-yet-classified apps see everything.
  const hiddenPaths = hiddenNavPathsForApp(activeApp.slug);
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !hiddenPaths.has(item.to)),
  })).filter((group) => group.items.length > 0);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside
        className={cn(
          "flex min-h-0 flex-col border-r border-border bg-card transition-all duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="relative flex h-20 items-center justify-center border-b border-border px-2">
          <img
            src={`${import.meta.env.BASE_URL}ivx-logo.png`}
            alt="IVX"
            className="h-16 w-16 shrink-0 object-contain"
          />
          {!collapsed && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center justify-center border-b border-border py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight size={16} />
          </button>
        )}

        <nav className={cn("min-h-0 flex-1 space-y-1 p-2", SCROLL_AREA)}>
          {visibleGroups.map((group) => (
            <div key={group.label} className="py-1">
              {!collapsed && (
                <p className="mb-1 px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
              )}
              {collapsed && <div className="my-1 border-t border-border" />}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      collapsed && "justify-center px-2",
                    )
                  }
                >
                  <item.icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">
          {collapsed ? "v0.1" : "IVX Console v0.1.0"}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{pageTitle}</h1>
            {showAppSelector && (
              <span
                title={
                  activeApp.isAllApps
                    ? "Showing combined data across all apps"
                    : `Scoped to ${activeApp.label}`
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  activeApp.isAllApps
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-primary/30 bg-primary/10 text-primary",
                )}
              >
                <Boxes size={12} />
                {activeApp.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {showAppSelector && <AppSelector />}
            <button
              onClick={toggleTheme}
              title={`Theme: ${theme}`}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
              {session?.username ?? "admin"}
            </span>
            <NavLink
              to="/settings"
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings size={16} />
            </NavLink>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <div className={cn("min-h-0 flex-1", SCROLL_AREA)}>
          <div className="p-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
