import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { LineChart, Briefcase, Receipt, FileText, BarChart3, Upload, TrendingUp, Scissors, DollarSign, SlidersHorizontal, ChevronDown, BookOpen, BookMarked, Scale, Gauge, Menu, X, Trash2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/ChatPanel";
import { AccountFilterProvider, useAccountFilter } from "@/lib/account-filter";
import { listAccounts, deleteAllTransactions, deleteAccount, DEMO_ACCOUNT } from "@/lib/transactions.functions";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

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
    ],
  },
  {
    label: "Data",
    items: [
      { to: "/transactions", label: "Transactions", icon: Receipt },
      { to: "/upload",       label: "Upload",       icon: Upload },
    ],
  },
  {
    label: "Advanced",
    items: [
      { to: "/advanced",   label: "Advanced Analytics", icon: Gauge },
      { to: "/financials", search: { tab: "balance" }, label: "Balance Sheet",      icon: Scale },
      { to: "/financials", search: { tab: "ledger"  }, label: "General Ledger",     icon: BookOpen },
      { to: "/financials", search: { tab: "coa"     }, label: "Chart of Accounts",  icon: BookMarked },
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
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none"><path d="M7 22 L14 15 L18 18.5 L25 9" stroke="#100d09" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 9 L25 9 L25 15.5" stroke="#100d09" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M7 22 L14 15 L18 18.5 L25 9" stroke="#100d09" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 9 L25 9 L25 15.5" stroke="#100d09" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
                            ? "text-sidebar-primary-foreground font-medium bg-sidebar-primary shadow-[0_0_14px_-4px_var(--primary)]"
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
            <AccountSelector />
            <ClearDataLink />
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <DemoDataBanner />
          <Outlet />
        </main>

        <ChatPanel />
      </div>
    </AccountFilterProvider>
  );
}

// Everything lives in this browser's localStorage now — there's no server
// session to sign out of, but there IS local data worth an explicit "start
// over" escape hatch (e.g. before handing the laptop to someone else).
function ClearDataLink() {
  const qc = useQueryClient();

  function handleClick() {
    const ok = window.confirm(
      "Clear all data on this device? This deletes every account, transaction, and symbol mapping stored in this browser. It cannot be undone — your original broker export is untouched, so you can always re-upload it.",
    );
    if (!ok) return;
    deleteAllTransactions();
    localStorage.removeItem("ss_symbol_mappings");
    localStorage.removeItem("selectedAccount");
    qc.clear();
    window.location.href = "/upload";
  }

  return (
    <div className="px-2 pt-2 mt-1 border-t border-sidebar-border">
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
      >
        <Trash2 className="h-4 w-4" /> Clear all data
      </button>
    </div>
  );
}

// Shown on every page whenever the sample portfolio is loaded, so it's never
// mistaken for real holdings no matter which page someone's on. Demo data and
// real data are mutually exclusive by design — uploading a real statement
// clears the demo account automatically (see upload.tsx) — so its mere
// presence in the account list is enough to know it's the only thing loaded.
function DemoDataBanner() {
  const qc = useQueryClient();
  const { setAccount } = useAccountFilter();

  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    staleTime: 30_000,
  });
  const isDemo = (accountsQ.data ?? []).includes(DEMO_ACCOUNT);

  const removeMutation = useMutation({
    mutationFn: () => deleteAccount({ data: { account: DEMO_ACCOUNT } }),
    onSuccess: () => {
      setAccount(null);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["nav-history"] });
      qc.invalidateQueries({ queryKey: ["inception-date"] });
      toast.success("Demo data removed");
    },
    onError: () => toast.error("Couldn't remove demo data. Try again."),
  });

  if (!isDemo) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2 bg-primary/10 border-b border-primary/20 text-sm">
      <Sparkles className="w-4 h-4 shrink-0 text-primary" />
      <span className="font-medium text-foreground">You're viewing sample data</span>
      <span className="text-muted-foreground">— not a real portfolio.</span>
      <div className="ml-auto flex items-center gap-3">
        <Link to="/upload" className="text-primary hover:underline font-medium">
          Upload your own statement
        </Link>
        <button
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
        >
          Remove demo data
        </button>
      </div>
    </div>
  );
}

