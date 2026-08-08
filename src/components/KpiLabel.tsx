import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Uppercase KPI label with a hover "?" explaining the formula / good-bad range in plain English. */
export function KpiLabel({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
      {children}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/40 text-muted-foreground/50 text-[9px] leading-none hover:border-muted-foreground hover:text-muted-foreground transition-colors cursor-help flex-shrink-0">
              ?
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px] text-xs leading-relaxed">
            {tip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
