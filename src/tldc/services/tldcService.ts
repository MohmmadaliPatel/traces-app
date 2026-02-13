/**
 * Client-side service for interacting with TLDC data API endpoints
 */
export const TldcService = {
  /**
   * Fetch TLDC data for a specific company
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

    // Parse financial year (e.g., "2023-24" to year and quarter)
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
   * Update TLDC data for a specific company
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
}
