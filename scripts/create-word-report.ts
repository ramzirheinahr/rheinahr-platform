import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType } from "docx";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { buildInvoicePdfData } from "../lib/invoice-pdf-builder";

async function generateAuditReport() {
  const invNumbers = [
    "482-134-0826", "479-181-0826", "506-176-0826",
    "500-279-0826", "503-229-0826", "510-280-0826",
    "492-107-0826", "489-118-0826", "507-114-0826", "508-114-0826",
    "547-273-0926", "429-147-0826", "528-105-0726", "563-253-0926",
    "540-209-0826", "520-277-0826", "562-290-0926", "504-273-0826",
    "578-118-0926", "579-246-0926"
  ];

  const reportData = [];
  let totalDiffNet = 0;

  for (const num of invNumbers) {
    const inv = await prisma.invoice.findUnique({
      where: { invoiceNumber: num },
      include: { client: true, assignments: { include: { order: true, worker: true } } }
    });
    if (!inv) continue;

    const zeroBreaks = inv.assignments.filter(a => a.order.breakMinutes === 0);
    const workers = Array.from(new Set(zeroBreaks.map(a => a.worker.fullName))).join(", ");
    const pdfData = buildInvoicePdfData(inv, inv.client, inv.assignments);
    const pdfItemsNet = pdfData.items.reduce((sum, item) => {
      const numStr = item.amount.replace(" €", "").replace(/\./g, "").replace(",", ".");
      const val = parseFloat(numStr);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
    const dbNet = Number(inv.netAmount);
    const diff = Math.round((pdfItemsNet - dbNet) * 100) / 100;
    totalDiffNet += diff;

    reportData.push({
      invoiceNumber: num,
      clientName: inv.client?.facilityName || "",
      zeroBreaksCount: zeroBreaks.length,
      workers,
      oldNet: dbNet,
      correctNet: pdfItemsNet,
      diff,
      status: inv.status === "paid" ? "مدفوعة (Bezahlt)" : "غير مدفوعة (Offen)",
      statusRaw: inv.status
    });
  }

  // Sort by diff descending
  reportData.sort((a, b) => b.diff - a.diff);

  const totalVat = Math.round(totalDiffNet * 0.19 * 100) / 100;
  const totalGross = Math.round((totalDiffNet + totalVat) * 100) / 100;

  const paidCount = reportData.filter(r => r.statusRaw === "paid").length;
  const unpaidCount = reportData.filter(r => r.statusRaw !== "paid").length;
  const paidDiffNet = reportData.filter(r => r.statusRaw === "paid").reduce((s, r) => s + r.diff, 0);
  const unpaidDiffNet = reportData.filter(r => r.statusRaw !== "paid").reduce((s, r) => s + r.diff, 0);

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  };

  const headerCell = (text: string, widthPercent: number) =>
    new TableCell({
      width: { size: widthPercent, type: WidthType.PERCENTAGE },
      shading: { fill: "1E3A8A", type: ShadingType.CLEAR },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 18 })],
        }),
      ],
      margins: { top: 120, bottom: 120, left: 100, right: 100 },
    });

  const bodyCell = (text: string, widthPercent: number, align = AlignmentType.LEFT, bold = false, color = "000000", highlight = false) =>
    new TableCell({
      width: { size: widthPercent, type: WidthType.PERCENTAGE },
      borders: cellBorder,
      shading: highlight ? { fill: "F3F4F6", type: ShadingType.CLEAR } : undefined,
      children: [
        new Paragraph({
          alignment: align,
          children: [new TextRun({ text, bold, color, size: 17 })],
        }),
      ],
      margins: { top: 80, bottom: 80, left: 80, right: 80 },
    });

  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell("رقم الفاتورة", 12),
        headerCell("العميل (Kunde)", 24),
        headerCell("الورديات المتأثرة", 10),
        headerCell("الموظفون", 18),
        headerCell("الصافي القديم", 11),
        headerCell("الصافي الصحيح", 11),
        headerCell("الفارق المستحق", 9),
        headerCell("الحالة", 11),
      ],
    }),
  ];

  for (const r of reportData) {
    const isPaid = r.statusRaw === "paid";
    tableRows.push(
      new TableRow({
        children: [
          bodyCell(r.invoiceNumber, 12, AlignmentType.CENTER, true),
          bodyCell(r.clientName, 24, AlignmentType.LEFT),
          bodyCell(`${r.zeroBreaksCount} وردية`, 10, AlignmentType.CENTER),
          bodyCell(r.workers, 18, AlignmentType.LEFT),
          bodyCell(`${r.oldNet.toFixed(2)} €`, 11, AlignmentType.RIGHT),
          bodyCell(`${r.correctNet.toFixed(2)} €`, 11, AlignmentType.RIGHT, true),
          bodyCell(`+${r.diff.toFixed(2)} €`, 9, AlignmentType.RIGHT, true, "B91C1C"),
          bodyCell(r.status, 11, AlignmentType.CENTER, false, isPaid ? "047857" : "B45309", isPaid),
        ],
      })
    );
  }

  // Summary Row
  tableRows.push(
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 6,
          width: { size: 86, type: WidthType.PERCENTAGE },
          shading: { fill: "E5E7EB", type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "إجمالي الفروقات المستحقة (Netto Gesamtdifferenz):", bold: true, size: 18 })],
            }),
          ],
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
        new TableCell({
          columnSpan: 2,
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: { fill: "FEE2E2", type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: `+${totalDiffNet.toFixed(2)} € Netto`, bold: true, color: "991B1B", size: 18 })],
            }),
          ],
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        }),
      ],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: "RheinAhr Dienstleistungen GmbH",
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "RheinAhr Dienstleistungen GmbH",
                bold: true,
                color: "1E3A8A",
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "تقرير التدقيق المالي والمحاسبي: فحص فواتير الورديات بدون استراحة (Break = 0)",
                bold: true,
                color: "111827",
                size: 24,
              }),
            ],
            spacing: { after: 120 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `تاريخ التقرير: ${new Date().toLocaleDateString("de-DE")} | إعداد: الإدارة التقنية والمالية`,
                italics: true,
                color: "4B5563",
                size: 18,
              }),
            ],
            spacing: { after: 300 },
          }),

          new Paragraph({
            text: "1. ملخص المشكلة التقنية (Technischer Hintergrund)",
            heading: HeadingLevel.HEADING_3,
            children: [
              new TextRun({ text: "1. ملخص المشكلة التقنية (Technischer Hintergrund)", bold: true, size: 22, color: "1E3A8A" })
            ],
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "عند توليد الفواتير برمجياً في قاعدة البيانات، كان يتم استخدام شرط منطقي احتياطي في الكود القديم: (breakMinutes || 30). ",
                size: 20,
              }),
              new TextRun({
                text: "وبما أن القيمة 0 تُعتبر Falsy في JavaScript، فقد كان النظام يعامل الوردية التي مدة استراحتها 0 دقيقة كأنها فارغة، ويخصم منها تلقائياً 30 دقيقة استراحة عند حساب الإجمالي المخزن (Netto).",
                size: 20,
              }),
            ],
            spacing: { after: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "المفارقة: في جدول بنود الفاتورة المطبوعة (PDF)، كانت الورديات تُطبع بالساعات الفعلية الكاملة الصحيحة، مما تسبب في نقص في المجموع النهائي المسجل في الفاتورة مقارنة بأسطر الجدول المعروضة للزبون.",
                size: 20,
                bold: true,
              }),
            ],
            spacing: { after: 240 },
          }),

          new Paragraph({
            text: "2. الإحصائيات والأثر المالي الإجمالي (Finanzielle Auswirkung)",
            heading: HeadingLevel.HEADING_3,
            children: [
              new TextRun({ text: "2. الإحصائيات والأثر المالي الإجمالي (Finanzielle Auswirkung)", bold: true, size: 22, color: "1E3A8A" })
            ],
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• إجمالي عدد الفواتير المتأثرة: `, bold: true, size: 20 }),
              new TextRun({ text: `20 فاتورة.`, size: 20 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• إجمالي فرق الصافي (Netto): `, bold: true, size: 20 }),
              new TextRun({ text: `+${totalDiffNet.toFixed(2)} € لصالح الشركة.`, bold: true, color: "B91C1C", size: 20 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• ضريبة القيمة المضافة (19% MwSt): `, bold: true, size: 20 }),
              new TextRun({ text: `+${totalVat.toFixed(2)} €.`, size: 20 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• الإجمالي الكلي مع الضريبة (Brutto): `, bold: true, size: 20 }),
              new TextRun({ text: `+${totalGross.toFixed(2)} €.`, bold: true, color: "B91C1C", size: 20 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• الفواتير غير المدفوعة (Offen): `, bold: true, size: 20 }),
              new TextRun({ text: `${unpaidCount} فاتورة بقيمة فرق صافي قدرها +${unpaidDiffNet.toFixed(2)} € (يمكن تحديثها وإرسالها فوراً).`, size: 20 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• الفواتير المدفوعة مسبقاً (Bezahlt): `, bold: true, size: 20 }),
              new TextRun({ text: `${paidCount} فواتير بقيمة فرق صافي قدرها +${paidDiffNet.toFixed(2)} € (تتطلب إصدار Nachberechnung / Korrektur).`, size: 20 }),
            ],
            spacing: { after: 240 },
          }),

          new Paragraph({
            text: "3. جدول الفواتير المتأثرة بالتفصيل (Detailübersicht der betroffenen Rechnungen)",
            heading: HeadingLevel.HEADING_3,
            children: [
              new TextRun({ text: "3. جدول الفواتير المتأثرة بالتفصيل (Detailübersicht der betroffenen Rechnungen)", bold: true, size: 22, color: "1E3A8A" })
            ],
            spacing: { before: 200, after: 140 },
          }),

          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),

          new Paragraph({
            text: "4. التوصيات والإجراءات المقترحة للإدارة (Handlungsempfehlungen)",
            heading: HeadingLevel.HEADING_3,
            children: [
              new TextRun({ text: "4. التوصيات والإجراءات المقترحة للإدارة (Handlungsempfehlungen)", bold: true, size: 22, color: "1E3A8A" })
            ],
            spacing: { before: 300, after: 100 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "1. المعالجة التقنية الدائمة: ", bold: true, size: 20 }),
              new TextRun({ text: "تم تصحيح الكود بالكامل واعتماد ?? بدلاً من ||، كما تم ربط مجموع الفاتورة برمجياً بمجموع بنود الجدول بالسنت مباشرة لمنع أي خطأ مستقبلي.", size: 20 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "2. الفواتير غير المدفوعة (13 فاتورة): ", bold: true, size: 20 }),
              new TextRun({ text: "تحديث قيمها في النظام فوراً وطباعتها وإرسالها للعملاء بالأرقام المصححة لاسترداد فارق الـ Netto البالغ ", size: 20 }),
              new TextRun({ text: `${unpaidDiffNet.toFixed(2)} €`, bold: true, size: 20 }),
              new TextRun({ text: ".", size: 20 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "3. الفواتير المدفوعة (7 فواتير): ", bold: true, size: 20 }),
              new TextRun({ text: "القرار لدى الإدارة المالية إما بإصدار فواتير تكميلية (Nachberechnung) للعملاء بفارق ", size: 20 }),
              new TextRun({ text: `${paidDiffNet.toFixed(2)} € Netto`, bold: true, size: 20 }),
              new TextRun({ text: "، أو تسويتها محاسبياً حسب السياسة المتبعة مع كل عميل.", size: 20 }),
            ],
            spacing: { after: 200 },
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outDir = path.resolve(process.cwd(), "public", "reports");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const filePath = path.join(outDir, "audit-report-invoices-zero-breaks.docx");
  fs.writeFileSync(filePath, buffer);

  // Also copy to current project root for easy access
  const rootPath = path.resolve(process.cwd(), "audit-report-invoices-zero-breaks.docx");
  fs.writeFileSync(rootPath, buffer);

  console.log("Report generated successfully at:");
  console.log(filePath);
  console.log(rootPath);
}

generateAuditReport().catch(console.error);
