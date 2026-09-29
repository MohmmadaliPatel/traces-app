/**
 * Client-side service for interacting with TLDC data API endpoints
 */
export const TldcService = {
  /**
   * Fetch TLDC data for a specific company (Old Act — Puppeteer)
   */
  async fetchTldcData({
    companyId,
    companyName,
    tan,
    fy,
    userId,
    password,
  }: {
    companyId: number
    companyName: string
    tan: string
    fy: string
    userId: string
    password: string
  }) {
    console.log(`Client: Fetching TLDC data for company: ${companyName} (${companyId})`)

    const yearParts = fy.split("-")
    const year = yearParts[0]

    try {
      const response = await fetch("/api/tldc/fetch-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tan,
          year,
          companyId,
          credentials: { userId, password, tan },
        }),
      })

      const result = await response.json()

      return {
        success: result.success,
        data: result.data,
        cached: result.cached || false,
        message:
          result.message || (result.success ? "Successfully fetched data" : "Failed to fetch data"),
      }
    } catch (error) {
      console.error("Error fetching TLDC data:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: "Failed to fetch TLDC data",
      }
    }
  },

  /**
   * Fetch TLDC data for New Act (REST: searchDeductor + PDFs + child-certificate)
   */
  async fetchTldcDataNewAct({
    companyId,
    companyName,
    tan,
    fy,
    userId,
    password,
    initiateIfNoRequest = true,
    forceInitiate = false,
  }: {
    companyId: number
    companyName: string
    tan: string
    fy: string
    userId: string
    password: string
    initiateIfNoRequest?: boolean
    forceInitiate?: boolean
  }) {
    console.log(
      `Client: Fetching New Act TLDC for ${companyName} (${companyId}), initiateIfNoRequest=${initiateIfNoRequest}, forceInitiate=${forceInitiate}`
    )

    try {
      const response = await fetch("/api/tldc/fetch-data-new-act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tan,
          fy,
          companyId,
          companyName,
          initiateIfNoRequest,
          forceInitiate,
          credentials: { userId, password, tan },
        }),
      })

      const result = await response.json()
      return {
        success: result.success,
        data: result.data,
        message:
          result.message ||
          (result.success ? "Successfully fetched New Act TLDC data" : "Failed to fetch"),
      }
    } catch (error) {
      console.error("Error fetching New Act TLDC data:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: "Failed to fetch New Act TLDC data",
      }
    }
  },

  /**
   * Update TLDC data for a specific company (Old Act)
   */
  async updateTldcData({
    companyId,
    companyName,
    tan,
    fy,
    userId,
    password,
  }: {
    companyId: number
    companyName: string
    tan: string
    fy: string
    userId: string
    password: string
  }) {
    console.log(`Client: Updating TLDC data for company: ${companyName} (${companyId})`)

    const yearParts = fy.split("-")
    const year = yearParts[0]

    try {
      const response = await fetch("/api/tldc/update-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tan,
          year,
          credentials: { userId, password, tan },
          companyId,
        }),
      })

      const result = await response.json()

      return {
        success: result.success,
        data: result.data,
        message:
          result.message ||
          (result.success ? "Successfully updated data" : "Failed to update data"),
      }
    } catch (error) {
      console.error("Error updating TLDC data:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: "Failed to update TLDC data",
      }
    }
  },

  /**
   * Update TLDC data for New Act via child-certificate API
   */
  async updateTldcDataNewAct({
    companyId,
    companyName,
    tan,
    fy,
    userId,
    password,
    recordId,
  }: {
    companyId: number
    companyName: string
    tan: string
    fy: string
    userId: string
    password: string
    recordId?: number
  }) {
    console.log(`Client: Updating New Act TLDC for ${companyName} (${companyId})`)

    try {
      const response = await fetch("/api/tldc/update-data-new-act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tan,
          fy,
          companyId,
          companyName,
          recordId,
          credentials: { userId, password, tan },
        }),
      })

      const result = await response.json()
      return {
        success: result.success,
        data: result.data,
        message:
          result.message ||
          (result.success ? "Successfully updated New Act TLDC data" : "Failed to update"),
      }
    } catch (error) {
      console.error("Error updating New Act TLDC data:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: "Failed to update New Act TLDC data",
      }
    }
  },
}
