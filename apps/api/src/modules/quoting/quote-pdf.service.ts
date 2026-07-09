import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";

export interface QuotePdfData {
  quoteId: string;
  customerName: string;
  origin: string;
  destination: string;
  mode: string;
  containerType: string | null;
  containerQuantity: number;
  incoterm: string;
  validUntil: Date;
  createdAt: Date;
  lines: Array<{
    chargeCode: string;
    description: string;
    quantity: number;
    sellCents: number;
    currency: string;
  }>;
  totalsByCurrency: Record<string, number>;
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Renders the customer-facing quote PDF. Sell side only — buy rates and
 * margins never leave the building.
 */
@Injectable()
export class QuotePdfService {
  async render(data: QuotePdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on("end", () => resolve(Buffer.concat(chunks))),
    );

    doc.fontSize(20).font("Helvetica-Bold").text("FORGE Freight");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555")
      .text("Digital freight forwarding for African trade corridors");
    doc.moveDown(1.5);

    doc.fillColor("#000").fontSize(14).font("Helvetica-Bold").text("Quotation");
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica");
    const meta: Array<[string, string]> = [
      ["Quote ref", data.quoteId],
      ["Customer", data.customerName],
      ["Lane", `${data.origin} → ${data.destination} (${data.mode})`],
      [
        "Equipment",
        data.containerType
          ? `${data.containerQuantity} × ${data.containerType}`
          : `${data.containerQuantity} shipment(s)`,
      ],
      ["Incoterm", data.incoterm],
      ["Issued", data.createdAt.toISOString().slice(0, 10)],
      ["Valid until", data.validUntil.toISOString().slice(0, 10)],
    ];
    for (const [k, v] of meta) {
      doc.font("Helvetica-Bold").text(`${k}: `, { continued: true }).font("Helvetica").text(v);
    }
    doc.moveDown(1);

    // Charge table
    const tableTop = doc.y;
    const col = { code: 50, desc: 110, qty: 330, unit: 380, total: 470 };
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Code", col.code, tableTop);
    doc.text("Description", col.desc, tableTop);
    doc.text("Qty", col.qty, tableTop);
    doc.text("Unit", col.unit, tableTop);
    doc.text("Amount", col.total, tableTop);
    doc
      .moveTo(50, tableTop + 14)
      .lineTo(545, tableTop + 14)
      .strokeColor("#999")
      .stroke();

    let y = tableTop + 22;
    doc.font("Helvetica").fontSize(9);
    for (const line of data.lines) {
      doc.text(line.chargeCode, col.code, y, { width: 55 });
      doc.text(line.description, col.desc, y, { width: 210 });
      doc.text(String(line.quantity), col.qty, y);
      doc.text(money(line.sellCents, line.currency), col.unit, y, { width: 85 });
      doc.text(money(line.sellCents * line.quantity, line.currency), col.total, y, {
        width: 90,
      });
      y += 18;
    }
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#999").stroke();
    y += 10;

    doc.font("Helvetica-Bold").fontSize(10);
    for (const [currency, total] of Object.entries(data.totalsByCurrency)) {
      doc.text(`Total (${currency}): ${money(total, currency)}`, col.unit - 50, y, {
        width: 230,
        align: "right",
      });
      y += 16;
    }

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#555")
      .text(
        "Rates subject to space and equipment availability at time of booking. " +
          "Duties, VAT and statutory charges are passed through at cost. " +
          "All business is transacted subject to our standard trading conditions.",
        50,
        y + 20,
        { width: 495 },
      );

    doc.end();
    return done;
  }
}
