import { Navigate } from "react-router-dom";

/** Product telemetry lives on the Dashboard tab — keep route for old bookmarks. */
export default function ProductTelemetryPage() {
  return <Navigate to="/dashboard?tab=telemetry" replace />;
}
