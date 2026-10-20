import "server-only";

import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  ImageRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  PageOrientation,
  VerticalAlign,
} from "docx";
import type { KklReportData } from "@/lib/kkl";

// Twips column widths extracted directly from the user's template docx
const COLUMN_WIDTHS_TWIPS = [1607, 1719, 1963, 1927, 1355, 1557, 1518, 1399, 1458];

function getLogoBuffer(): Buffer | null {
  const candidates = [
    path.join(process.cwd(), "smartstart logo.jpg"),
    path.join(process.cwd(), "public", "smartstart-logo.jpg"),
    path.join(process.cwd(), "public", "smartstart logo.jpg"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p);
      } catch {}
    }
  }
  return null;
}

export async function renderKklDocx(data: KklReportData): Promise<Buffer> {
  const logoBuffer = getLogoBuffer();

  // Solid thin borders matching Word template (Tabellengitternetz)
  const cellBorder = {
    style: BorderStyle.SINGLE,
    size: 4, // 0.5 pt
    color: "000000",
  };
  const tableBorders = {
    top: cellBorder,
    bottom: cellBorder,
    left: cellBorder,
    right: cellBorder,
    insideHorizontal: cellBorder,
    insideVertical: cellBorder,
  };

  // Header row
  const headerTitles = [
    ["Name, Vorname"],
    ["Geburtsdatum"],
    ["SV-Nummer"],
    ["Tätigkeitsbereich"],
    ["VS netto"],
    ["Beginn"],
    ["Ende"],
    ["Stunden,", "Woche"],
    ["HÜL"],
  ];

  const headerCells = headerTitles.map((lines, i) => {
    return new TableCell({
      width: { size: COLUMN_WIDTHS_TWIPS[i], type: WidthType.DXA },
      shading: { fill: "D9D9D9" },
      verticalAlign: VerticalAlign.CENTER,
      children: lines.map(
        (line) =>
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 40 },
            children: [
              new TextRun({
                text: line,
                bold: true,
                size: 20, // 10 pt
                font: "Calibri",
              }),
            ],
          }),
      ),
    });
  });

  const headerRow = new TableRow({
    tableHeader: true,
    children: headerCells,
  });

  // Data rows
  const dataRows: TableRow[] = data.rows.map((row) => {
    const values = [
      row.workerName,
      row.birthDate,
      row.socialSecurityNumber,
      row.qualificationCode,
      row.hourlyRateFormatted,
      row.startDateFormatted,
      row.endDateFormatted,
      row.weeklyHoursFormatted,
      row.shiftCodesFormatted,
    ];

    return new TableRow({
      children: values.map((val, i) => {
        return new TableCell({
          width: { size: COLUMN_WIDTHS_TWIPS[i], type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 30, after: 30 },
              children: [
                new TextRun({
                  text: val || "",
                  size: 20, // 10 pt
                  font: "Calibri",
                }),
              ],
            }),
          ],
        });
      }),
    });
  });

  // Pad with empty rows to match template layout (at least 35 rows total or matching template)
  const totalRowsTarget = Math.max(35, dataRows.length + 5);
  const emptyRowsNeeded = totalRowsTarget - dataRows.length;
  for (let r = 0; r < emptyRowsNeeded; r++) {
    dataRows.push(
      new TableRow({
        children: COLUMN_WIDTHS_TWIPS.map((width) => {
          return new TableCell({
            width: { size: width, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                spacing: { before: 30, after: 30 },
                children: [new TextRun({ text: "", size: 20, font: "Calibri" })],
              }),
            ],
          });
        }),
      }),
    );
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: COLUMN_WIDTHS_TWIPS,
    borders: tableBorders,
    rows: [headerRow, ...dataRows],
  });

  // Document paragraphs matching user template exactly
  const bodyParagraphs = [
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: "Anlage zum Arbeitnehmerüberlassungsvertrag",
          bold: true,
          size: 24, // 12 pt
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: "Zwischen",
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: data.company.name || "Personaldienstleister",
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: data.company.street || "Theaterplatz 1",
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: data.company.city || "53177 Bonn",
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: "(nachfolgend: Personaldienstleister)",
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: "und",
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text:
            data.client.companyAndAddress ||
            "Rheinische Gesellschaft für Diakonie gGmbH, Hasensprung 1, 42799 Leichlingen",
          size: 20,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: "(nachfolgend: Kundenunternehmen)",
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: `Einrichtung: ${data.client.facilityName}`,
          size: 22,
          font: "Calibri",
        }),
      ],
    }),
    table,
  ];

  // Header with logo
  const headerChildren: Paragraph[] = [];
  if (logoBuffer) {
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 80 },
        children: [
          new ImageRun({
            data: logoBuffer,
            transformation: {
              width: 320,
              height: 104, // 981x320 ratio preserved
            },
            type: "jpg",
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: 16838, // A4 landscape twips
              height: 11906,
            },
            margin: {
              top: 1417, // 25mm
              bottom: 1417,
              left: 1134, // 20mm
              right: 1417,
              header: 708, // 12.5mm
            },
          },
        },
        headers: {
          default: new Header({
            children: headerChildren,
          }),
        },
        children: bodyParagraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
