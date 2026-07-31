import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { LineChart, Briefcase, Receipt, FileText, BarChart3, Upload, TrendingUp, Scissors, DollarSign, SlidersHorizontal, ChevronDown, BookOpen, BookMarked, Scale, RefreshCw, Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/ChatPanel";
import { AccountFilterProvider, useAccountFilter } from "@/lib/account-filter";
import { listAccounts } from "@/lib/transactions.functions";
import { syncDropbox, type SyncSummary } from "@/lib/sync.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState, useRef, useEffect } from "react";

// Queries that depend on transaction data — invalidated after a Dropbox sync.
const DEPENDENT_KEYS = [
  ["transactions"], ["accounts"], ["nav-history"],
  ["performance"], ["inception-date"], ["symbol_mappings"], ["prices"],
];

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function DropboxSync() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    for (const k of DEPENDENT_KEYS) qc.invalidateQueries({ queryKey: k });
  };

  // Auto-sync on load, on window refocus, and every 15 minutes while open.
  const syncQ = useQuery({
    queryKey: ["dropbox-sync"],
    queryFn: async () => (await syncDropbox({ data: {} })) as SyncSummary,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 15 * 60 * 1000,
  });

  // Refresh dependent views whenever a sync actually changed something.
  useEffect(() => {
    const s = syncQ.data;
    if (!s || !s.configured) return;
    const changed = s.accounts.some((a) => a.status === "imported") || s.removed.length > 0;
    if (changed) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncQ.dataUpdatedAt]);

  const summary = syncQ.data;
  // Stay hidden until Dropbox is configured, so it doesn't clutter Phase-0 installs.
  if (summary && !summary.configured) return null;

  async function manualRefresh() {
    setBusy(true);
    try {
      const s = (await syncDropbox({ data: { force: true } })) as SyncSummary;
      invalidate();
      qc.setQueryData(["dropbox-sync"], s);
      const imported = s.accounts.filter((a) => a.status === "imported");
      const unsupported = s.accounts.filter((a) => a.status === "unsupported");
      const errored = s.accounts.filter((a) => a.status === "error");
      if (errored.length) {
        toast.error(`Sync issue: ${errored.map((e) => e.account).join(", ")}`);
      } else {
        let msg = imported.length
          ? `Synced ${imported.length} account${imported.length > 1 ? "s" : ""}`
          : "Already up to date";
        if (s.removed.length) msg += `, removed ${s.removed.length}`;
        if (unsupported.length) msg += ` · ${unsupported.length} unsupported`;
        // Flag partially-incomplete files so a truncated import isn't mistaken for a clean one.
        const skipped = imported.reduce((sum, a) => sum + (a.skipped ?? 0), 0);
        if (skipped) msg += ` · ${skipped} row${skipped > 1 ? "s" : ""} skipped`;
        toast.success(msg);
      }
    } catch (e: any) {
      toast.error("Sync failed: " + (e?.message ?? "unknown error"));
    } finally {
      setBusy(false);
    }
  }

  const syncing = busy || syncQ.isFetching;

  return (
    <div className="px-3 pb-3">
      <button
        onClick={manualRefresh}
        disabled={syncing}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-60"
      >
        <RefreshCw className={cn("w-3.5 h-3.5 shrink-0", syncing && "animate-spin")} />
        <span className="flex-1 text-left">{syncing ? "Syncing…" : "Refresh from Dropbox"}</span>
      </button>
      {summary?.syncedAt && !syncing && (
        <p className="px-2 mt-1 text-[10px] text-muted-foreground">
          Synced {timeAgo(summary.syncedAt)}
        </p>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated")({
  component: AppLayout,
});

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  search?: Record<string, string>;
};

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard",   label: "Dashboard",   icon: LineChart },
      { to: "/performance", label: "Performance", icon: TrendingUp },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { to: "/holdings",    label: "Holdings",    icon: Briefcase },
      { to: "/income",      label: "Income",      icon: DollarSign },
      { to: "/sp500",       label: "Indices",     icon: BarChart3 },
      { to: "/rebalancing", label: "Rebalancing", icon: SlidersHorizontal },
      { to: "/tax-loss",    label: "Tax Loss",    icon: Scissors },
    ],
  },
  {
    label: "Financials",
    items: [
      { to: "/financials", search: { tab: "capital" }, label: "Capital Statement",  icon: FileText },
      { to: "/financials", search: { tab: "income"  }, label: "Income Statement",   icon: TrendingUp },
      { to: "/financials", search: { tab: "balance" }, label: "Balance Sheet",      icon: Scale },
      { to: "/financials", search: { tab: "ledger"  }, label: "General Ledger",     icon: BookOpen },
      { to: "/financials", search: { tab: "coa"     }, label: "Chart of Accounts",  icon: BookMarked },
    ],
  },
  {
    label: "Data",
    items: [
      { to: "/transactions", label: "Transactions", icon: Receipt },
      { to: "/upload",       label: "Upload",       icon: Upload },
    ],
  },
];

function AccountSelector() {
  const { account, setAccount } = useAccountFilter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    staleTime: 30_000,
  });
  const accounts = accountsQ.data ?? [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function select(a: string | null) {
    setAccount(a);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["nav-history"] });
    qc.invalidateQueries({ queryKey: ["performance"] });
    qc.invalidateQueries({ queryKey: ["inception-date"] });
  }

  if (accounts.length === 0) return null;

  const label = account ?? "All accounts";

  return (
    <div ref={ref} className="relative px-3 pb-4">
      <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Account
      </p>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/60"
      >
        <span className="flex-1 truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-3 right-3 bottom-full z-50 mb-1 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          <button
            onClick={() => select(null)}
            className={cn(
              "w-full text-left px-3 py-2 text-sm transition-colors",
              account === null
                ? "bg-primary/8 text-primary font-medium"
                : "text-foreground hover:bg-muted/60",
            )}
          >
            All accounts
          </button>
          {accounts.map((a) => (
            <button
              key={a}
              onClick={() => select(a)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors",
                account === a
                  ? "bg-primary/8 text-primary font-medium"
                  : "text-foreground hover:bg-muted/60",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  return (
    <AccountFilterProvider>
      <div className="liquid-backdrop" aria-hidden="true" />
      <div className="relative z-10 h-dvh flex flex-col md:flex-row overflow-hidden">
        {/* Mobile top bar (hidden on md+) */}
        <header className="md:hidden glass-surface flex items-center gap-3 h-14 px-4 shrink-0 rounded-none border-x-0 border-t-0">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="-ml-1.5 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-sky-400 to-blue-700 flex items-center justify-center shrink-0 shadow-[0_0_12px_-2px_oklch(0.74_0.135_235_/_0.6)]">
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="10.5" stroke="#04101f" strokeWidth="4" opacity="0.55"/><path d="M16 5.5 a10.5 10.5 0 0 1 9.1 5.25" stroke="#04101f" strokeWidth="4" strokeLinecap="round"/></svg>
            </div>
            <span className="font-display font-semibold text-sm tracking-tight">StockStarter</span>
          </div>
        </header>

        {/* Drawer backdrop (mobile). Kept mounted and faded via opacity — not
            conditionally unmounted — so iOS Safari repaints the status-bar/toolbar
            safe areas on close instead of leaving a lingering dark tint. */}
        <div
          className={cn(
            "md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          onClick={() => setMobileOpen(false)}
        />

        <aside
          className={cn(
            "glass-surface w-60 rounded-none border-y-0 border-l-0 flex flex-col shrink-0 z-50",
            "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform max-md:duration-200",
            mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
          )}
        >
          {/* Logo */}
          <div className="px-5 py-5 border-b border-sidebar-border flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-blue-700 flex items-center justify-center shrink-0 shadow-[0_0_14px_-2px_oklch(0.74_0.135_235_/_0.65)]">
                <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="10.5" stroke="#04101f" strokeWidth="4" opacity="0.55"/><path d="M16 5.5 a10.5 10.5 0 0 1 9.1 5.25" stroke="#04101f" strokeWidth="4" strokeLinecap="round"/></svg>
              </div>
              <span className="font-display font-semibold text-sm tracking-tight">StockStarter</span>
            </div>
            {/* Close (mobile only) */}
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="md:hidden p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Nav (min-h-0 lets it actually scroll instead of growing and pushing
              the footer off a short screen) */}
          <nav className="flex-1 min-h-0 px-3 py-4 space-y-5 overflow-y-auto">
            {navSections.map((section) => (
              <div key={section.label}>
                <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const searchParams = new URLSearchParams(location.search);
                    const active = item.search
                      ? location.pathname === item.to &&
                        Object.entries(item.search).every(([k, v]) => searchParams.get(k) === v)
                      : location.pathname.startsWith(item.to);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to + (item.search?.tab ?? "")}
                        to={item.to as any}
                        search={item.search as any}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-full text-sm transition-all duration-300",
                          active
                            ? "text-sidebar-primary-foreground font-medium bg-gradient-to-r from-sky-400/90 to-blue-600/80 shadow-[0_0_18px_-4px_oklch(0.74_0.135_235_/_0.8),inset_0_1px_0_0_oklch(0.9_0.05_235_/_0.4)]"
                            : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent",
                        )}
                      >
                        <Icon className={cn("w-4 h-4 shrink-0", active ? "text-sidebar-primary-foreground" : "")} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer — divided from the scrolling nav above. */}
          <div className="border-t border-sidebar-border pt-2 shrink-0">
            <DropboxSync />
            <AccountSelector />
            <SignOutLink />
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>

        <ChatPanel />
      </div>
    </AccountFilterProvider>
  );
}

function SignOutLink() {
  return (
    <div className="px-2 pt-2 mt-1 border-t border-sidebar-border">
      <a
        href="/__logout"
        className="flex items-center gap-2 px-3 py-2 text-sm rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </a>
    </div>
  );
}

