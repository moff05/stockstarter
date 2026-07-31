import { formatMoney } from "./portfolio";

export type StatementLine = {
  label: string;
  value: number;
  bold?: boolean;
  indent?: boolean;
  separator?: boolean;
};

export type StatementPDFData = {
  quarter: 1 | 2 | 3 | 4;
  year: number;
  periodStart: string;
  periodEnd: string;
  isPartial: boolean;
  lines: StatementLine[];
};

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export async function exportStatementPDF(data: StatementPDFData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 60;

  // Header
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text("STATEMENT OF PARTNER'S CAPITAL", pageW / 2, 60, { align: "center" });

  doc.setFontSize(20);
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.text(`Q${data.quarter} ${data.year}`, pageW / 2, 86, { align: "center" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  const dateRange = `${fmtDate(data.periodStart)} — ${fmtDate(data.periodEnd)}${data.isPartial ? " (to-date)" : ""}`;
  doc.text(dateRange, pageW / 2, 104, { align: "center" });

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, 118, pageW - margin, 118);

  // Table
  const tableBody: [string, string][] = data.lines.map((l) => [l.label, formatMoney(l.value)]);

  autoTable(doc, {
    startY: 132,
    margin: { left: margin, right: margin },
    body: tableBody,
    bodyStyles: { fontSize: 10, cellPadding: { top: 6, bottom: 6, left: 4, right: 4 } },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right", cellWidth: 120 },
    },
    didParseCell: (hookData: any) => {
      const line = data.lines[hookData.row.index];
      if (!line) return;
      if (line.bold) {
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.textColor = [20, 20, 20];
      }
      if (line.indent && !line.bold) {
        hookData.cell.styles.textColor = [80, 80, 80];
        if (hookData.column.index === 0) {
          hookData.cell.styles.cellPadding = { top: 6, bottom: 6, left: 20, right: 4 };
        }
      }
      if (line.value < 0 && hookData.column.index === 1) {
        hookData.cell.styles.textColor = [180, 40, 40];
      } else if (line.value > 0 && line.indent && hookData.column.index === 1) {
        hookData.cell.styles.textColor = [16, 140, 90];
      }
      if (line.separator || (line.bold && hookData.row.index > 0)) {
        hookData.cell.styles.lineWidth = { top: 0.5 };
        hookData.cell.styles.lineColor = [200, 200, 200];
      }
    },
    tableLineColor: [230, 230, 230],
    tableLineWidth: 0.5,
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? 300;

  // Footer notes
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.setFont("helvetica", "normal");
  const notes = [
    `Unrealized gain reflects mark-to-market change between ${fmtDate(data.periodStart)} and ${fmtDate(data.periodEnd)}.`,
    "Numbers may be incomplete for securities without a matched ticker symbol.",
    `Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
  ];
  let y = finalY + 24;
  for (const note of notes) {
    doc.text(`* ${note}`, margin, y);
    y += 14;
  }

  doc.save(`Capital-Statement-Q${data.quarter}-${data.year}.pdf`);
}
