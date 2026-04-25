import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { PlayerLayout } from "./layouts/PlayerLayout";
import { AuthGuard } from "./components/AuthGuard";
import { LoginPage } from "./pages/auth/LoginPage";
import { SignupPage } from "./pages/auth/SignupPage";
import { HomePage } from "./pages/HomePage";

const EventsPage = lazy(() => import("./pages/EventsPage"));
const EventDetailPage = lazy(() => import("./pages/EventDetailPage"));
const StorePage = lazy(() => import("./pages/StorePage"));
const OfferDetailPage = lazy(() => import("./pages/OfferDetailPage"));
const LeaderboardsPage = lazy(() => import("./pages/LeaderboardsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const FriendsPage = lazy(() => import("./pages/FriendsPage"));
const DailyRewardsPage = lazy(() => import("./pages/DailyRewardsPage"));
const QuestsPage = lazy(() => import("./pages/QuestsPage"));
const BattlepassPage = lazy(() => import("./pages/BattlepassPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const InboxPage = lazy(() => import("./pages/InboxPage"));
const EnergyPage = lazy(() => import("./pages/EnergyPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ChallengesPage = lazy(() => import("./pages/ChallengesPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const TeamsPage = lazy(() => import("./pages/TeamsPage"));
const ReferralPage = lazy(() => import("./pages/ReferralPage"));

function Loading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route
          element={
            <AuthGuard>
              <PlayerLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:id" element={<EventDetailPage />} />
          <Route path="store" element={<StorePage />} />
          <Route path="store/:id" element={<OfferDetailPage />} />
          <Route path="leaderboards" element={<LeaderboardsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="profile/friends" element={<FriendsPage />} />
          <Route path="daily-rewards" element={<DailyRewardsPage />} />
          <Route path="quests" element={<QuestsPage />} />
          <Route path="battlepass" element={<BattlepassPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="energy" element={<EnergyPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="challenges" element={<ChallengesPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="referral" element={<ReferralPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </Suspense>
  );
}
