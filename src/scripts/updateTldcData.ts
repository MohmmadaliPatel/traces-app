import {
  openTraces61ApiSession,
  postLegacyServletJson,
  type Traces61ApiSession,
} from "../jobs/traces"

/**
 * TLDC certificate verification — API-only (no Puppeteer).
 *
 * The legacy 197certiverfication.xhtml page feeds its grid from CertiVerifyServlet:
 *   POST /app/ded/srv/CertiVerifyServlet?deducteePan=<pan>&financialYear=<startYear>&certiNo=<certNo>&reqType=1
 *   → jqGrid JSON { rows: [{ serialno, certino, finyear, deducteepan, dedname, validfrm,
 *                            cncldate, validto, seccode, natofpayment, rateoftds, certilimit,
 *                            amtconsume, issuedate, quarter, formtype, certid, remark, tanCode }] }
 */

/** CertiVerifyServlet row → the legacy rowData shape used by callers. */
function mapCertRow(row: Record<string, any>): Record<string, string> {
  const cell = (key: string) => String(row[key] ?? "").trim()
  return {
    serialNo: cell("serialno"),
    certNumber: cell("certino"),
    fy: cell("finyear"),
    pan: cell("deducteepan"),
    panName: cell("dedname"),
    validFrom: cell("validfrm"),
    cancelDate: cell("cncldate"),
    validTo: cell("validto"),
    section: cell("seccode"),
    NatureOfPayment: cell("natofpayment"),
    tdsRate: cell("rateoftds"),
    tdsAmountLimit: cell("certilimit"),
    tdsAmountConsumed: cell("amtconsume"),
    issueDate: cell("issuedate"),
    _rowHtml: "",
  }
}

/**
 * Fetch TLDC Data for a specific TAN, year and quarter
 */
export async function updateTldcData({
  year,
  tldcData,
  credentials = { userId: "", password: "", tan: "" },
}: {
  year: string
  tldcData: any[]
  credentials: { userId: string; password: string; tan: string }
}): Promise<{ data: any; cached?: boolean }> {
  console.log("⏳ No cache. Fetching TLDC verification via API for:", year)

  if (!tldcData || tldcData.length === 0) {
    console.log("⚠️ No TLDC data to update")
    return { data: [] }
  }

  let session: Traces61ApiSession | undefined
  try {
    session = await openTraces61ApiSession(credentials)
    const processedData: any[] = []

    const financialYear = year.split("-")[0] || ""

    // Process each TLDC record
    for (const tldc of tldcData) {
      console.log(`🔍 Processing certificate: ${tldc.certNumber}, PAN: ${tldc.pan}`)

      try {
        const data = await postLegacyServletJson(
          session,
          `app/ded/srv/CertiVerifyServlet?deducteePan=${encodeURIComponent(
            String(tldc.pan || "")
          )}&financialYear=${encodeURIComponent(financialYear)}&certiNo=${encodeURIComponent(
            String(tldc.certNumber || "")
          )}&reqType=1`
        )

        const rows = Array.isArray(data?.rows) ? data.rows : []
        if (rows.length === 0) {
          console.log(`⚠️ No data found in certificate verification table for ${tldc.certNumber}`)
          processedData.push({
            certNumber: tldc.certNumber,
            pan: tldc.pan,
            error: "No data found in certificate verification table",
          })
        } else {
          console.log(
            `✅ Successfully extracted data for certificate ${tldc.certNumber}:`,
            rows
          )
          for (const row of rows) {
            processedData.push(mapCertRow(row))
          }
        }
      } catch (certError) {
        console.error(`❌ Error processing certificate ${tldc.certNumber}:`, certError)
        processedData.push({
          certNumber: tldc.certNumber,
          pan: tldc.pan,
          error: certError instanceof Error ? certError.message : String(certError),
        })
      }

      // Wait between requests to avoid overloading the server
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    console.log(`✅ Processing complete. Found data for ${processedData.length} certificates`)
    return { data: processedData }
  } catch (error) {
    console.error("❌ Error in updateTldcData:", error)
    throw error
  } finally {
    await session?.close()
  }
}
