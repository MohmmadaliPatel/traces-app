import PdfPrinter from "pdfmake"
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces"
import type { ExportTable } from "./types"

const fonts = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
}

const printer = new PdfPrinter(fonts)

function cellText(value: string | number): string {
  if (value === null || value === undefined) return ""
  return String(value)
}

export async function toPdf(table: ExportTable): Promise<Buffer> {
  const headerRow = table.headers.map((h) => ({
    text: h,
    style: "tableHeader",
  }))
  const bodyRows = table.rows.map((row) =>
    row.map((cell) => ({
      text: cellText(cell),
      style: "tableCell",
    }))
  )

  const content: Content[] = [
    { text: table.title, style: "title", margin: [0, 0, 0, 12] },
    {
      text: `Generated ${new Date().toLocaleString("en-IN")}`,
      style: "meta",
      margin: [0, 0, 0, 16],
    },
    {
      table: {
        headerRows: 1,
        widths: table.headers.map(() => "*"),
        body: [headerRow, ...bodyRows],
      },
      layout: {
        fillColor: (rowIndex: number) => {
          if (rowIndex === 0) return "#1f4e79"
          return rowIndex % 2 === 0 ? "#f5f7fa" : null
        },
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => "#cbd5e1",
        vLineColor: () => "#cbd5e1",
        paddingLeft: () => 4,
        paddingRight: () => 4,
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
    },
  ]

  const docDefinition: TDocumentDefinitions = {
    pageOrientation: "landscape",
    pageSize: "A4",
    pageMargins: [24, 24, 24, 32],
    defaultStyle: {
      font: "Helvetica",
      fontSize: 8,
    },
    styles: {
      title: { fontSize: 14, bold: true, color: "#0f172a" },
      meta: { fontSize: 8, color: "#64748b" },
      tableHeader: { bold: true, color: "#ffffff", fontSize: 7 },
      tableCell: { fontSize: 7, color: "#0f172a" },
    },
    footer: (currentPage, pageCount) => ({
      text: `Page ${currentPage} of ${pageCount}`,
      alignment: "center",
      fontSize: 8,
      color: "#94a3b8",
      margin: [0, 8, 0, 0],
    }),
    content,
  }

  const pdfDoc = printer.createPdfKitDocument(docDefinition)
  const chunks: Buffer[] = []

  return new Promise<Buffer>((resolve, reject) => {
    pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk))
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)))
    pdfDoc.on("error", reject)
    pdfDoc.end()
  })
}
