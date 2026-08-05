import { AlertTriangle, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { affectedSymbols, type UnmatchedSell } from "@/lib/data-integrity";

export function DataIntegrityBanner({ issues }: { issues: UnmatchedSell[] }) {
  const symbols = affectedSymbols(issues);
  const key = `data-integrity-dismissed:${symbols.slice().sort().join(",")}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "1") setDismissed(true);
      else setDismissed(false);
    } catch {}
  }, [key]);

  if (issues.length === 0 || dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(key, "1"); } catch {}
    setDismissed(true);
  }

  return (
    <Card className="p-4 border-amber-300 bg-amber-50 text-amber-900 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {symbols.length} position{symbols.length === 1 ? "" : "s"} may have understated cost basis
        </div>
        <p className="text-sm mt-0.5">
          We found sale{issues.length === 1 ? "" : "s"} with no matching purchase on record for{" "}
          {symbols.length === 1 ? symbols[0] : `${symbols.length} symbols`} — usually this means the
          uploaded history doesn't go back to when the position was first bought. Cost basis, realized
          gain, and tax-loss numbers for {symbols.length === 1 ? "this position" : "these positions"} may
          be understated. For accurate numbers, upload your full transaction history from when you first
          bought{symbols.length === 1 ? "" : " each position"}, not just a recent date range.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {symbols.slice(0, 12).map((s) => (
            <span key={s} className="font-mono text-xs px-2 py-0.5 rounded bg-amber-100 border border-amber-200">
              {s}
            </span>
          ))}
          {symbols.length > 12 && (
            <span className="text-xs text-amber-700">+{symbols.length - 12} more</span>
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
