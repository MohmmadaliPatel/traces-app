import {
  openTraces61ApiSession,
  postLegacyServletJson,
  type Traces61ApiSession,
} from "../jobs/traces"

/**
 * Outstanding Demand — API-only (no Puppeteer).
 *
 * The legacy page feeds its two grids from TagChallanServlet:
 *   POST /app/ded/srv/TagChallanServlet?reqtype=0   → current years (rows: finYr, aodmnd, cpcdmd, fin)
 *   POST /app/ded/srv/TagChallanServlet?reqtype=11  → "Prior Years" rows (same shape)
 * A "Prior Years" row has `fin === 1` (see outstandingdemand.xhtml grid JS).
 */
export async function fetchOutstandingDemand({
  credentials,
}: {
  credentials: { userId: string; password: string; tan: string }
}): Promise<{ data: any; priorYearsData?: any }> {
  let session: Traces61ApiSession | undefined
  try {
    console.log("🚀 Starting Outstanding Demand fetch (API)...")
    session = await openTraces61ApiSession(credentials)

    const demandData = await postLegacyServletJson(session, "app/ded/srv/TagChallanServlet?reqtype=0")
    console.log("✅ Received demand data:", demandData)

    let priorYearsData: any = null
    const hasPriorYears = Array.isArray(demandData?.rows)
      ? demandData.rows.some((row: any) => row.fin === 1)
      : false

    if (hasPriorYears) {
      console.log("📋 Prior Years detected — fetching prior years feed...")
      priorYearsData = await postLegacyServletJson(
        session,
        "app/ded/srv/TagChallanServlet?reqtype=11"
      )
      console.log("✅ Received prior years data:", priorYearsData)
    }

    return {
      data: demandData,
      priorYearsData: priorYearsData,
    }
  } catch (error) {
    console.error("❌ Error in fetchOutstandingDemand:", error)
    throw error
  } finally {
    await session?.close()
  }
}
