import {
  openTraces61ApiSession,
  postLegacyServletJson,
  type Traces61ApiSession,
} from "../jobs/traces"

/**
 * Return Status — API-only (no Puppeteer).
 *
 * The legacy stmtstatus.xhtml page feeds its grid from DedStmtStatusServlet:
 *   POST /app/ded/srv/DedStmtStatusServlet?financialYear=<startYear>&quarter=<3..6>&formType=<24Q|…>&reqType=1
 *   → { totalpages, page, rowCount, rows: [{ finyear, quarter, formtype, tokenno, dtoffiling,
 *                                            status, dtofprcng, stmnttype, remarks, reason }] }
 * Rejected rows expose the failure text via:
 *   POST /app/ded/srv/DedStmtStatusServlet?reqType=5  body: errIds=<row.remarks>
 *   → [{ failMsg }]
 */
export async function fetchReturnStatus({
  credentials,
  financialYears,
  quarters,
  formTypes,
}: {
  credentials: { userId: string; password: string; tan: string }
  financialYears: string[]
  quarters: string[]
  formTypes: string[]
}): Promise<{ data: any[] }> {
  let session: Traces61ApiSession | undefined
  try {
    console.log("🚀 Starting Return Status fetch (API)...")
    session = await openTraces61ApiSession(credentials)

    const allResults: any[] = []

    /** Fetch one combination with server-side pagination (rows=100 per page). */
    const fetchCombination = async (financialYear: string, quarter: string, formType: string) => {
      const rows: any[] = []
      let pageNo = 1
      let totalpages = 1
      for (;;) {
        const data = await postLegacyServletJson(
          session!,
          `app/ded/srv/DedStmtStatusServlet?financialYear=${encodeURIComponent(
            financialYear
          )}&quarter=${encodeURIComponent(quarter)}&formType=${encodeURIComponent(
            formType
          )}&reqType=1`,
          { body: `_search=false&nd=${Date.now()}&rows=100&page=${pageNo}&sidx=&sord=asc` }
        )
        if (Array.isArray(data.rows)) rows.push(...data.rows)
        totalpages = Number(data.totalpages) || 1
        if (pageNo >= totalpages || !Array.isArray(data.rows) || data.rows.length === 0) break
        pageNo++
      }
      return { rows, totalpages }
    }

    for (const financialYear of financialYears) {
      for (const quarter of quarters) {
        for (const formType of formTypes) {
          console.log(
            `🔍 Fetching data for FY: ${financialYear}, Quarter: ${quarter}, Form: ${formType}`
          )
          try {
            const { rows, totalpages } = await fetchCombination(financialYear, quarter, formType)

            // Rejection reasons for rejected rows (reqType=5, errIds = row.remarks).
            for (const row of rows) {
              if (
                row.status &&
                row.status.toLowerCase().includes("reject") &&
                row.reason &&
                row.reason.toLowerCase().includes("view rejection reason") &&
                row.remarks
              ) {
                try {
                  const rejection = await postLegacyServletJson(
                    session!,
                    "app/ded/srv/DedStmtStatusServlet?reqType=5",
                    { body: `errIds=${encodeURIComponent(String(row.remarks))}` }
                  )
                  const failMsg = Array.isArray(rejection) ? rejection[0]?.failMsg : rejection?.failMsg
                  if (failMsg) row.rejectionMsg = failMsg
                } catch (error) {
                  console.error(`Error fetching rejection reason for ${row.tokenno}:`, error)
                }
              }
            }

            if (rows.length > 0) {
              allResults.push({
                financialYear,
                quarter,
                formType,
                data: {
                  rows,
                  totalPages: totalpages,
                  totalRecords: rows.length,
                },
              })
              console.log(`✅ Total records collected: ${rows.length}`)
            } else {
              console.log(`⚠️ No data received for this combination`)
            }
          } catch (error) {
            console.error(
              `❌ Error fetching data for FY: ${financialYear}, Q: ${quarter}, Form: ${formType}`,
              error
            )
          }
        }
      }
    }

    console.log(`✅ Completed fetching. Total combinations: ${allResults.length}`)
    return { data: allResults }
  } catch (error) {
    console.error("❌ Error in fetchReturnStatus:", error)
    throw error
  } finally {
    await session?.close()
  }
}
