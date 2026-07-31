import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkUpsertMappings,
  deleteMapping,
  listMappings,
  upsertMapping,
  type Mapping,
} from "@/lib/symbol-mappings.functions";
import { listTransactions } from "@/lib/transactions.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CUSIP_SEED, buildResolver, isCusip } from "@/lib/symbol-resolver";

export const Route = createFileRoute("/_authenticated/mappings")({
  head: () => ({ meta: [{ title: "Symbol Mappings — StockStarter" }] }),
  component: MappingsPage,
});

type Row = {
  cusip: string;
  ticker: string;
  name: string;
  asset_class: string;
  existingId?: string;
  isMapped: boolean;
  source: "user" | "seed" | "unmapped";
};

function MappingsPage() {
  const qc = useQueryClient();

  const txnsQ = useQuery({ queryKey: ["transactions", "all"], queryFn: () => listTransactions({ data: {} }) });
  const mapsQ = useQuery({ queryKey: ["symbol_mappings"], queryFn: () => listMappings() });

  const txns = txnsQ.data ?? [];
  const mappings = (mapsQ.data ?? []) as Mapping[];
  const resolve = useMemo(() => buildResolver(mappings), [mappings]);

  // Collect every unique CUSIP from transactions plus any user-saved mappings.
  const rows = useMemo<Row[]>(() => {
    const byCusip = new Map<string, Row>();

    // First pass: every CUSIP found on a transaction (auto-detect).
    for (const t of txns as any[]) {
      const sym: string | null = t.symbol;
      if (!sym || !isCusip(sym)) continue;
      const cusip = sym.toUpperCase();
      if (byCusip.has(cusip)) continue;
      const r = resolve(cusip);
      const description = (t.description ?? "").toString();
      byCusip.set(cusip, {
        cusip,
        ticker: r.ticker ?? "",
        name: r.name ?? description.split(/\d/)[0].trim().slice(0, 60),
        asset_class: "",
        existingId: mappings.find((m) => m.cusip === cusip)?.id,
        isMapped: r.isMapped,
        source: r.source === "passthrough" ? "user" : r.source,
      });
    }
    // Add any saved mappings that are not present in transactions.
    for (const m of mappings) {
      if (byCusip.has(m.cusip)) continue;
      byCusip.set(m.cusip, {
        cusip: m.cusip,
        ticker: m.ticker ?? "",
        name: m.name ?? "",
        asset_class: m.asset_class ?? "",
        existingId: m.id,
        isMapped: !!m.ticker,
        source: "user",
      });
    }
    return Array.from(byCusip.values()).sort((a, b) =>
      Number(a.isMapped) - Number(b.isMapped) || a.cusip.localeCompare(b.cusip),
    );
  }, [txns, mappings, resolve]);

  const [edits, setEdits] = useState<Record<string, { ticker: string; name: string }>>({});

  function setEdit(cusip: string, field: "ticker" | "name", value: string) {
    setEdits((prev) => ({
      ...prev,
      [cusip]: { ...prev[cusip], [field]: value } as any,
    }));
  }

  const save = useMutation({
    mutationFn: (row: Row & { ticker: string; name: string }) =>
      upsertMapping({
        data: { cusip: row.cusip, ticker: row.ticker || null, name: row.name || null },
      }),
    onSuccess: () => {
      toast.success("Mapping saved");
      qc.invalidateQueries({ queryKey: ["symbol_mappings"] });
      qc.invalidateQueries({ queryKey: ["prices"] });
      setEdits({});
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteMapping({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["symbol_mappings"] }),
  });

  const seedAll = useMutation({
    mutationFn: async () => {
      // Apply built-in seed for every detected CUSIP that matches.
      const toInsert = rows
        .filter((r) => !r.isMapped)
        .map((r) => {
          const hit = CUSIP_SEED.find((s) => s.cusip === r.cusip);
          if (!hit) return null;
          return {
            cusip: r.cusip,
            ticker: hit.ticker,
            name: hit.name,
            asset_class: hit.asset_class,
          };
        })
        .filter(Boolean) as { cusip: string; ticker: string; name: string; asset_class: string }[];
      if (!toInsert.length) return { inserted: 0 };
      return await bulkUpsertMappings({ data: { rows: toInsert } });
    },
    onSuccess: (r: any) => {
      toast.success(`Applied ${r.inserted ?? 0} suggested mappings`);
      qc.invalidateQueries({ queryKey: ["symbol_mappings"] });
      qc.invalidateQueries({ queryKey: ["prices"] });
    },
  });

  const unmappedCount = rows.filter((r) => !r.isMapped).length;
  const suggestable = rows.filter((r) => !r.isMapped && CUSIP_SEED.some((s) => s.cusip === r.cusip)).length;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Symbol Mappings</h1>
          <p className="text-sm text-muted-foreground">
            Fifth Third statements use CUSIPs instead of tickers. Map each CUSIP to its ticker so
            live prices and S&amp;P comparisons work. {rows.length} symbols • {unmappedCount} unmapped.
          </p>
        </div>
        {suggestable > 0 && (
          <Button onClick={() => seedAll.mutate()} disabled={seedAll.isPending}>
            <Sparkles className="w-4 h-4 mr-1" /> Auto-fill {suggestable} from built-in catalog
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CUSIP</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  No CUSIPs detected. Upload a CSV with Fifth Third asset numbers.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const edit = edits[r.cusip] ?? { ticker: r.ticker, name: r.name };
              const dirty =
                (edits[r.cusip] !== undefined) &&
                (edit.ticker !== r.ticker || edit.name !== r.name);
              return (
                <TableRow key={r.cusip}>
                  <TableCell className="font-mono text-xs">{r.cusip}</TableCell>
                  <TableCell>
                    <Input
                      className="h-8 w-28 uppercase font-medium"
                      value={edit.ticker}
                      placeholder="e.g. AAPL"
                      onChange={(e) => setEdit(r.cusip, "ticker", e.target.value.toUpperCase())}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8"
                      value={edit.name}
                      placeholder="Apple Inc."
                      onChange={(e) => setEdit(r.cusip, "name", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    {r.isMapped ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        {r.source === "seed" ? "Built-in" : "Mapped"}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        Needs ticker
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        size="sm"
                        variant={dirty ? "default" : "ghost"}
                        disabled={!edit.ticker || save.isPending}
                        onClick={() =>
                          save.mutate({ ...r, ticker: edit.ticker, name: edit.name })
                        }
                      >
                        <Save className="w-4 h-4" />
                      </Button>
                      {r.existingId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => del.mutate(r.existingId!)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        Tip: Ticker symbols power live pricing via Yahoo Finance. For mutual funds use the share-class
        ticker (e.g. APHFX, EIBLX); for ETFs and stocks use the standard ticker (e.g. SPY, AAPL).
      </p>
    </div>
  );
}
