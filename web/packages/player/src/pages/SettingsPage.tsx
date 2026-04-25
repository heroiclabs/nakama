import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { nakama, useRpcOptions, useAuthStore } from "@nakama/shared";
import type { ConsoleAccount } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NotificationPrefs {
  pushEnabled: boolean;
  emailEnabled: boolean;
  inboxEnabled: boolean;
  soundEnabled: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  pushEnabled: true,
  emailEnabled: true,
  inboxEnabled: true,
  soundEnabled: true,
};

function loadPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem("nakama-notification-prefs");
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

function savePrefs(p: NotificationPrefs) {
  localStorage.setItem("nakama-notification-prefs", JSON.stringify(p));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDate(iso?: string): string {
  if (!iso || iso === "1970-01-01T00:00:00Z") return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function SettingsPage() {
  const rpcOpts = useRpcOptions();
  const qc = useQueryClient();
  const logout = useAuthStore((s) => s.logout);

  const {
    data: account,
    isLoading,
    isError,
    error,
  } = useQuery<ConsoleAccount>({
    queryKey: ["nakama", "account"],
    queryFn: () => nakama.getAccount(rpcOpts),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !account) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">
            Failed to load account
            {error instanceof Error ? `: ${error.message}` : "."}
          </p>
          <button
            className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            onClick={() =>
              qc.invalidateQueries({ queryKey: ["nakama", "account"] })
            }
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Header />
      <ProfileSection account={account} rpcOpts={rpcOpts} qc={qc} />
      <AccountInfoSection account={account} />
      <DevicesSection account={account} rpcOpts={rpcOpts} qc={qc} />
      <NotificationPrefsSection />
      <DangerZone onLogout={logout} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header() {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
      <p className="text-muted-foreground">
        Manage your account, devices, and notification preferences.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile Section                                                    */
/* ------------------------------------------------------------------ */

function ProfileSection({
  account,
  rpcOpts,
  qc,
}: {
  account: ConsoleAccount;
  rpcOpts: ReturnType<typeof useRpcOptions>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const user = account.user;

  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [langTag, setLangTag] = useState(user.lang_tag ?? "");
  const [location, setLocation] = useState(user.location ?? "");
  const [timezone, setTimezone] = useState(user.timezone ?? "");

  useEffect(() => {
    setDisplayName(user.display_name ?? "");
    setAvatarUrl(user.avatar_url ?? "");
    setLangTag(user.lang_tag ?? "");
    setLocation(user.location ?? "");
    setTimezone(user.timezone ?? "");
  }, [user]);

  const isDirty =
    displayName !== (user.display_name ?? "") ||
    avatarUrl !== (user.avatar_url ?? "") ||
    langTag !== (user.lang_tag ?? "") ||
    location !== (user.location ?? "") ||
    timezone !== (user.timezone ?? "");

  const updateMut = useMutation({
    mutationFn: () =>
      nakama.updateAccount(
        {
          display_name: displayName,
          avatar_url: avatarUrl,
          lang_tag: langTag,
          location,
          timezone,
        },
        rpcOpts,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nakama", "account"] });
    },
  });

  const reset = useCallback(() => {
    setDisplayName(user.display_name ?? "");
    setAvatarUrl(user.avatar_url ?? "");
    setLangTag(user.lang_tag ?? "");
    setLocation(user.location ?? "");
    setTimezone(user.timezone ?? "");
  }, [user]);

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">Profile</h3>
        <p className="text-xs text-muted-foreground">
          Update your display name, avatar, and locale settings.
        </p>
      </div>

      <div className="space-y-4 p-5">
        {/* Avatar preview */}
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xl font-bold text-muted-foreground">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="avatar"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              (displayName || user.username || "?").charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {user.username}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {account.email || "No email linked"}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Display Name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="Your display name"
          />
          <Field
            label="Avatar URL"
            value={avatarUrl}
            onChange={setAvatarUrl}
            placeholder="https://..."
          />
          <Field
            label="Language"
            value={langTag}
            onChange={setLangTag}
            placeholder="en"
          />
          <Field
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="US"
          />
          <Field
            label="Timezone"
            value={timezone}
            onChange={setTimezone}
            placeholder="America/New_York"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            disabled={!isDirty || updateMut.isPending}
            onClick={() => updateMut.mutate()}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors",
              isDirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {updateMut.isPending && (
              <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
            )}
            Save Changes
          </button>
          {isDirty && (
            <button
              onClick={reset}
              className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
            >
              Discard
            </button>
          )}
        </div>

        {updateMut.isSuccess && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2">
            <CheckIcon className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700">
              Profile updated successfully.
            </span>
          </div>
        )}
        {updateMut.isError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Update failed
            {updateMut.error instanceof Error
              ? `: ${updateMut.error.message}`
              : "."}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Account Info (read-only)                                           */
/* ------------------------------------------------------------------ */

function AccountInfoSection({ account }: { account: ConsoleAccount }) {
  const user = account.user;

  const rows: [string, string][] = [
    ["User ID", user.user_id],
    ["Username", user.username],
    ["Email", account.email || "—"],
    ["Custom ID", account.custom_id || "—"],
    ["Created", fmtDate(user.create_time)],
    ["Updated", fmtDate(user.update_time)],
    ["Verified", account.verify_time && account.verify_time !== "1970-01-01T00:00:00Z" ? fmtDate(account.verify_time) : "Not verified"],
    ["Status", account.disable_time && account.disable_time !== "1970-01-01T00:00:00Z" ? "Disabled" : "Active"],
  ];

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">Account Details</h3>
        <p className="text-xs text-muted-foreground">
          Read-only account information from your Nakama profile.
        </p>
      </div>
      <div className="divide-y divide-border">
        {rows.map(([label, val]) => (
          <div
            key={label}
            className="flex items-center justify-between px-5 py-3"
          >
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="max-w-[60%] truncate text-right text-sm font-medium">
              {val}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Devices Section                                                    */
/* ------------------------------------------------------------------ */

function DevicesSection({
  account,
  rpcOpts,
  qc,
}: {
  account: ConsoleAccount;
  rpcOpts: ReturnType<typeof useRpcOptions>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const devices = account.devices ?? [];

  const unlinkMut = useMutation({
    mutationFn: (deviceId: string) =>
      nakama.unlinkDevice(deviceId, rpcOpts),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["nakama", "account"] }),
  });

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">Linked Devices</h3>
        <p className="text-xs text-muted-foreground">
          Devices associated with your account.
        </p>
      </div>

      {devices.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          No devices linked to this account.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between px-5 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <DeviceIcon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium font-mono truncate max-w-xs">
                    {d.id}
                  </p>
                  <p className="text-xs text-muted-foreground">Device ID</p>
                </div>
              </div>

              <button
                disabled={unlinkMut.isPending || devices.length <= 1}
                onClick={() => {
                  if (
                    confirm(
                      "Unlink this device? You won't be able to log in with it anymore.",
                    )
                  ) {
                    unlinkMut.mutate(d.id);
                  }
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  devices.length > 1
                    ? "border border-destructive/30 text-destructive hover:bg-destructive/5"
                    : "cursor-not-allowed text-muted-foreground",
                )}
                title={
                  devices.length <= 1
                    ? "Cannot unlink the only device"
                    : "Unlink this device"
                }
              >
                {unlinkMut.isPending ? (
                  <SpinnerIcon className="h-3 w-3 animate-spin" />
                ) : (
                  <UnlinkIcon className="h-3.5 w-3.5" />
                )}
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}

      {unlinkMut.isError && (
        <div className="border-t border-border px-5 py-3">
          <p className="text-xs text-destructive">
            Unlink failed
            {unlinkMut.error instanceof Error
              ? `: ${unlinkMut.error.message}`
              : "."}
          </p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Notification Preferences                                           */
/* ------------------------------------------------------------------ */

function NotificationPrefsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadPrefs);

  const toggle = (key: keyof NotificationPrefs) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      savePrefs(next);
      return next;
    });
  };

  const items: { key: keyof NotificationPrefs; label: string; desc: string }[] =
    [
      {
        key: "pushEnabled",
        label: "Push Notifications",
        desc: "Receive push notifications on your device.",
      },
      {
        key: "emailEnabled",
        label: "Email Notifications",
        desc: "Receive important updates via email.",
      },
      {
        key: "inboxEnabled",
        label: "In-App Inbox",
        desc: "Show notifications in your in-app inbox.",
      },
      {
        key: "soundEnabled",
        label: "Notification Sounds",
        desc: "Play sounds for incoming notifications.",
      },
    ];

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">Notification Preferences</h3>
        <p className="text-xs text-muted-foreground">
          Control how and when you receive notifications.
        </p>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between px-5 py-4"
          >
            <div>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                prefs[item.key] ? "bg-primary" : "bg-muted-foreground/30",
              )}
              role="switch"
              aria-checked={prefs[item.key]}
            >
              <span
                className={cn(
                  "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                  prefs[item.key] ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Danger Zone                                                        */
/* ------------------------------------------------------------------ */

function DangerZone({ onLogout }: { onLogout: () => void }) {
  return (
    <section className="rounded-lg border border-destructive/30 bg-destructive/5">
      <div className="border-b border-destructive/20 px-5 py-4">
        <h3 className="text-base font-semibold text-destructive">
          Danger Zone
        </h3>
        <p className="text-xs text-muted-foreground">
          Irreversible actions for your account.
        </p>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Sign Out</p>
            <p className="text-xs text-muted-foreground">
              End your current session and return to the login screen.
            </p>
          </div>
          <button
            onClick={() => {
              if (confirm("Sign out of your account?")) {
                onLogout();
                window.location.href = "/";
              }
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
          >
            <LogoutIcon className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared components                                                  */
/* ------------------------------------------------------------------ */

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-background px-3 text-sm transition-colors",
          "focus:outline-none focus:ring-1 focus:ring-primary",
          "placeholder:text-muted-foreground/50",
          disabled && "cursor-not-allowed opacity-50",
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function DeviceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function UnlinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
      <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
      <line x1="8" x2="8" y1="2" y2="5" />
      <line x1="2" x2="5" y1="8" y2="8" />
      <line x1="16" x2="16" y1="19" y2="22" />
      <line x1="19" x2="22" y1="16" y2="16" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

export default SettingsPage;
