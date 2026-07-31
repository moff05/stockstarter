import { Link } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";

export function UnmappedBanner({ unmapped }: { unmapped: string[] }) {
  const key = `unmapped-dismissed:${[...unmapped].sort().join(",")}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "1") setDismissed(true);
      else setDismissed(false);
    } catch {}
  }, [key]);

  if (!unmapped || unmapped.length === 0 || dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(key, "1"); } catch {}
    setDismissed(true);
  }

  return (
    <Card className="p-4 border-amber-300 bg-amber-50 text-amber-900 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {unmapped.length} security ID{unmapped.length === 1 ? "" : "s"} couldn't be matched to a ticker
        </div>
        <p className="text-sm mt-0.5">
          Some securities in the statement are identified by an internal security number rather than
          a stock ticker (e.g. AAPL). Without a ticker, live prices and S&P comparisons won't load
          for those positions.{" "}
          <Link to="/mappings" className="underline font-medium">Add ticker mappings →</Link>
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {unmapped.slice(0, 12).map((c) => (
            <span key={c} className="font-mono text-xs px-2 py-0.5 rounded bg-amber-100 border border-amber-200">
              {c}
            </span>
          ))}
          {unmapped.length > 12 && (
            <span className="text-xs text-amber-700">+{unmapped.length - 12} more</span>
          )}
        </div>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 p-1 rounded hover:bg-amber-100 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-amber-700" />
      </button>
    </Card>
  );
}

