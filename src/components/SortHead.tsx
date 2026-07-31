import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export type SortConfig = { key: string; dir: SortDir } | null;

export function useSortable(defaultKey?: string, defaultDir: SortDir = "desc") {
  const [sort, setSort] = useState<SortConfig>(
    defaultKey ? { key: defaultKey, dir: defaultDir } : null,
  );
  function handleSort(key: string) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }
  return [sort, handleSort] as const;
}

export function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  sort: SortConfig,
): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    let cmp: number;
    if (typeof av === "string" && typeof bv === "string") {
      cmp = av.localeCompare(bv);
    } else {
      const an = av == null ? -Infinity : Number(av);
      const bn = bv == null ? -Infinity : Number(bv);
      cmp = an > bn ? 1 : an < bn ? -1 : 0;
    }
    return sort.dir === "desc" ? -cmp : cmp;
  });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3 h-3 opacity-30 shrink-0" />;
  return dir === "desc"
    ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
    : <ChevronUp className="w-3.5 h-3.5 shrink-0" />;
}

export function SortHead({
  label, sortKey, sort, onSort, className,
}: {
  label: string;
  sortKey: string;
  sort: SortConfig;
  onSort: (k: string) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <TableHead
      className={cn("cursor-pointer select-none hover:text-foreground whitespace-nowrap", className)}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <SortIcon active={active} dir={sort?.dir ?? "desc"} />
      </span>
    </TableHead>
  );
}

