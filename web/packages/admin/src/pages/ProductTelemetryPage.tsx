import { Navigate } from "react-router-dom";

/** Growth marketing lives on the Dashboard tab — keep route for old bookmarks. */
export default function ProductTelemetryPage() {
  return <Navigate to="/dashboard?tab=growth" replace />;
}
