import { useState } from "react";
import { Eye, EyeOff, RotateCcw, Save, Wifi, WifiOff } from "lucide-react";
import { useAdminStore, getEffectiveServerKey } from "@/stores/admin-store";
import { NAKAMA_BASE_URL } from "@nakama/shared";

export function SettingsPage() {
  const { serverKeyOverride, theme, setServerKeyOverride, setTheme } = useAdminStore();

  const [keyInput, setKeyInput] = useState(serverKeyOverride ?? "");
  const [revealed, setRevealed] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  function handleSave() {
    const trimmed = keyInput.trim();
    setServerKeyOverride(trimmed.length > 0 ? trimmed : null);
  }

  function handleReset() {
    setServerKeyOverride(null);
    setKeyInput("");
  }

  async function handleTestConnection() {
    setTestStatus("loading");
    try {
      const key = getEffectiveServerKey();
      const res = await fetch(`${NAKAMA_BASE_URL}/healthcheck`, {
        headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
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
          <h3 className="text-lg font-semibold">Server Key</h3>
          <div className="relative">
            <input
              type={revealed ? "text" : "password"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Leave empty to use default key"
              className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Save size={14} />
              Save
            </button>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              <RotateCcw size={14} />
              Reset to Default
            </button>
          </div>
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

export { SettingsPage as default };

export default SettingsPage;
