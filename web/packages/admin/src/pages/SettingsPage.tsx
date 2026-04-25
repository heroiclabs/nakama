import { useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useAdminStore } from "@/stores/admin-store";
import { useAdminAuth } from "@/auth/admin-auth";

export function SettingsPage() {
  const { theme, setTheme } = useAdminStore();
  const { session } = useAdminAuth();
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  async function handleTestConnection() {
    setTestStatus("loading");
    try {
      const res = await fetch("/admin-dashboard/api/rpc/admin_health_check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.token ?? ""}`,
        },
        body: JSON.stringify({}),
      });
      setTestStatus(res.ok ? "ok" : "error");
    } catch {
      setTestStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Admin console configuration.</p>
      </div>

      <div className="max-w-xl space-y-8">
        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Admin Session</h3>
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">User</span>
              <span className="font-medium">{session?.username ?? "unknown"}</span>
            </div>
            <div className="mt-2 flex justify-between gap-4">
              <span className="text-muted-foreground">Role</span>
              <span className="font-medium">{session?.role ?? "admin"}</span>
            </div>
            <div className="mt-2 flex justify-between gap-4">
              <span className="text-muted-foreground">Expires</span>
              <span className="font-medium">
                {session?.expiresAt
                  ? new Date(session.expiresAt * 1000).toLocaleString()
                  : "unknown"}
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Nakama HTTP and console credentials are held by the server-side admin
            proxy and are no longer stored or edited in the browser.
          </p>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Theme</h3>
          <div className="flex gap-1 rounded-md border border-input p-1">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  theme === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Connection Test</h3>
          <div className="flex items-center gap-4">
            <button
              onClick={handleTestConnection}
              disabled={testStatus === "loading"}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {testStatus === "loading" ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : testStatus === "ok" ? (
                <Wifi size={14} className="text-green-500" />
              ) : testStatus === "error" ? (
                <WifiOff size={14} className="text-destructive" />
              ) : (
                <Wifi size={14} />
              )}
              Test Connection
            </button>
            {testStatus === "ok" && (
              <span className="text-sm text-green-500">Connected successfully</span>
            )}
            {testStatus === "error" && (
              <span className="text-sm text-destructive">Connection failed</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}


export default SettingsPage;
