import { useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import {
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
  Database,
  Gamepad2,
  Terminal,
  Wallet,
  UserCheck,
  BarChart3,
  Download,
  Settings,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/stores/admin-store";

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
    items: [{ label: "Dashboard", to: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Game Systems",
    items: [
      { label: "Hiro Config", to: "/hiro-config", icon: Puzzle },
      { label: "Satori Config", to: "/satori-config", icon: Sparkles },
    ],
  },
  {
    label: "LiveOps",
    items: [
      { label: "Feature Flags", to: "/flags", icon: Flag },
      { label: "Live Events", to: "/events", icon: CalendarClock },
      { label: "Experiments", to: "/experiments", icon: FlaskConical },
      { label: "Audiences", to: "/audiences", icon: UsersRound },
      { label: "Messages", to: "/messages", icon: MessageSquare },
    ],
  },
  {
    label: "Players",
    items: [
      { label: "Players", to: "/players", icon: Users },
      { label: "Accounts", to: "/accounts", icon: Shield },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Offers", to: "/offers", icon: Tag },
      { label: "Quests Config", to: "/quests-config", icon: ScrollText },
      { label: "Battle Pass Config", to: "/battlepass-config", icon: Award },
      { label: "Achievements", to: "/achievements", icon: Medal },
      { label: "Leaderboards Config", to: "/leaderboards-config", icon: Trophy },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { label: "Storage", to: "/storage", icon: Database },
      { label: "Matches", to: "/matches", icon: Gamepad2 },
      { label: "Server Logs", to: "/logs", icon: Terminal },
      { label: "Economy", to: "/economy", icon: Wallet },
      { label: "Retention", to: "/retention", icon: UserCheck },
      { label: "Analytics", to: "/analytics", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Config Export", to: "/config-export", icon: Download },
      { label: "Settings", to: "/settings", icon: Settings },
      { label: "Developer Guide", to: "/dev-guide", icon: BookOpen },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function getPageTitle(pathname: string) {
  const item = ALL_NAV_ITEMS.find((i) => i.to === pathname);
  return item?.label ?? "Admin Console";
}

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { theme, setTheme, serverKeyOverride } = useAdminStore();

  const pageTitle = getPageTitle(location.pathname);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          "flex flex-col border-r border-border bg-card transition-all duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          {!collapsed && (
            <span className="text-sm font-bold tracking-tight text-primary">
              NAKAMA ADMIN
            </span>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV_GROUPS.map((group) => (
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
          {collapsed ? "v0.1" : "Nakama Admin v0.1.0"}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur">
          <h1 className="text-lg font-semibold">{pageTitle}</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              title={`Theme: ${theme}`}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div
              title={serverKeyOverride ? "Custom server key set" : "Using default key"}
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                serverKeyOverride ? "bg-green-500" : "bg-muted-foreground/40",
              )}
            />
            <NavLink
              to="/settings"
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings size={16} />
            </NavLink>
          </div>
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
