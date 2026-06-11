import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AdminAuthProvider, useAdminAuth } from "./auth/admin-auth";
import { AdminLayout } from "./layouts/AdminLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";

const PlayersPage = lazy(() => import("./pages/PlayersPage"));
const HiroConfigPage = lazy(() => import("./pages/HiroConfigPage"));
const SatoriConfigPage = lazy(() => import("./pages/SatoriConfigPage"));
const FlagsPage = lazy(() => import("./pages/FlagsPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const EventDebuggerPage = lazy(() => import("./pages/EventDebuggerPage"));
const FunnelsPage = lazy(() => import("./pages/FunnelsPage"));
const ExperimentsPage = lazy(() => import("./pages/ExperimentsPage"));
const AudiencesPage = lazy(() => import("./pages/AudiencesPage"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));
const AccountsPage = lazy(() => import("./pages/AccountsPage"));
const OffersPage = lazy(() => import("./pages/OffersPage"));
const QuestsConfigPage = lazy(() => import("./pages/QuestsConfigPage"));
const BattlepassConfigPage = lazy(() => import("./pages/BattlepassConfigPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const LeaderboardsConfigPage = lazy(() => import("./pages/LeaderboardsConfigPage"));
const StoragePage = lazy(() => import("./pages/StoragePage"));
const MatchesPage = lazy(() => import("./pages/MatchesPage"));
const LogsPage = lazy(() => import("./pages/LogsPage"));
const EconomyPage = lazy(() => import("./pages/EconomyPage"));
const RetentionPage = lazy(() => import("./pages/RetentionPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const ConfigExportPage = lazy(() => import("./pages/ConfigExportPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DevGuidePage = lazy(() => import("./pages/DevGuidePage"));

function Loading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function ProtectedRoutes() {
  const { isAuthenticated } = useAdminAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="hiro-config" element={<HiroConfigPage />} />
        <Route path="satori-config" element={<SatoriConfigPage />} />
        <Route path="flags" element={<FlagsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="event-debugger" element={<EventDebuggerPage />} />
        <Route path="funnels" element={<FunnelsPage />} />
        <Route path="experiments" element={<ExperimentsPage />} />
        <Route path="audiences" element={<AudiencesPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="quests-config" element={<QuestsConfigPage />} />
        <Route path="battlepass-config" element={<BattlepassConfigPage />} />
        <Route path="achievements" element={<AchievementsPage />} />
        <Route path="leaderboards-config" element={<LeaderboardsConfigPage />} />
        <Route path="storage" element={<StoragePage />} />
        <Route path="matches" element={<MatchesPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="economy" element={<EconomyPage />} />
        <Route path="retention" element={<RetentionPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="config-export" element={<ConfigExportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="dev-guide" element={<DevGuidePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AdminAuthProvider>
      <Suspense fallback={<Loading />}>
        <ProtectedRoutes />
      </Suspense>
    </AdminAuthProvider>
  );
}
