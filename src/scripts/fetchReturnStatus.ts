import puppeteer from "puppeteer"
import {
  loginWithTracesApiAndPreauth,
  rewriteTracesNewPortalUrlToTraces61,
  traces61DedUrl,
} from "../jobs/traces"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let globalPage: any = null

async function loginToTdsPortal(credentials: {
  userId: string
  password: string
  tan: string
}): Promise<any> {
  if (globalPage) {
    console.log("Reusing existing browser session")
    return globalPage
  }

  console.log("Starting new browser session...")
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : undefined,
  })

  const page = await browser.newPage()

  await loginWithTracesApiAndPreauth(
    page,
    {
      userId: credentials.userId,
      password: credentials.password,
      tan: credentials.tan,
    },
    { redirectGuard: false }
  )

  globalPage = page
  return globalPage
}

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
  try {
    console.log("🚀 Starting Return Status fetch...")
    const page = await loginToTdsPortal(credentials)

    const allResults: any[] = []

    // Set up request interception ONCE before processing
    await page.setRequestInterception(true)

    let currentReturnStatusData: any = null
    const currentRejectionMessages: Record<string, string> = {}

    // Listen for ALL API responses
    page.on("response", async (response: any) => {
      const url = response.url()

      // Main return status data (reqType=1)
      if (url.includes("DedStmtStatusServlet") && url.includes("reqType=1")) {
        try {
          const data = await response.json()
          console.log(`✅ Received return status data:`, data)
          currentReturnStatusData = data
        } catch (error) {
          console.error("Error parsing return status data:", error)
        }
      }
      // Rejection reason data (reqType=5)
      else if (url.includes("DedStmtStatusServlet") && url.includes("reqType=5")) {
        try {
          const data = await response.json()
          console.log(`✅ Received rejection reason:`, data)
          if (data && data.length > 0 && data[0].failMsg) {
            currentRejectionMessages.latest = data[0].failMsg
          }
        } catch (error) {
          console.error("Error parsing rejection reason:", error)
        }
      }
    })

    // Allow all requests to continue
    page.on("request", (request: any) => {
      const url = rewriteTracesNewPortalUrlToTraces61(request.url())
      if (url !== request.url()) {
        request.continue({ url })
      } else {
        request.continue()
      }
    })

    // Navigate to return status page
    console.log("📄 Navigating to Return Status page...")
    await page.goto(traces61DedUrl("stmtstatus.xhtml"), {
      waitUntil: "networkidle2",
      timeout: 60000,
    })

    await delay(3000)

    // Process each combination of financial year, quarter, and form type
    for (const financialYear of financialYears) {
      for (const quarter of quarters) {
        for (const formType of formTypes) {
          console.log(
            `🔍 Fetching data for FY: ${financialYear},type: ${typeof financialYear}, Quarter: ${quarter}, type: ${typeof quarter}, Form: ${formType}, type: ${typeof formType}`
          )

          try {
            // Reset data for this iteration
            currentReturnStatusData = null
            currentRejectionMessages.latest = ""

            // Select financial year with multiple attempts
            await page.waitForSelector("#financialYear", { visible: true, timeout: 10000 })
            
            // Use evaluate to set value directly
            await page.evaluate((fy) => {
              const select = document.querySelector("#financialYear") as HTMLSelectElement
              if (select) {
                console.log("🔍 Setting financial year:", fy)
                select.value = fy
                // Trigger change event
                const event = new Event("change", { bubbles: true })
                select.dispatchEvent(event)
              }
            }, financialYear)
            
            console.log(`✅ Selected Financial Year: ${financialYear}`)
            await delay(2000)

            // Select quarter
            await page.waitForSelector("#quarter", { visible: true, timeout: 10000 })
            
            await page.evaluate((q) => {
              const select = document.querySelector("#quarter") as HTMLSelectElement
              if (select) {
                select.value = q
                const event = new Event("change", { bubbles: true })
                select.dispatchEvent(event)
              }
            }, quarter)
            
            console.log(`✅ Selected Quarter: ${quarter}`)
            await delay(2000)

            // Select form type
            await page.waitForSelector("#formType", { visible: true, timeout: 10000 })
            
            await page.evaluate((ft) => {
              const select = document.querySelector("#formType") as HTMLSelectElement
              if (select) {
                select.value = ft
                const event = new Event("change", { bubbles: true })
                select.dispatchEvent(event)
              }
            }, formType)
            
            console.log(`✅ Selected Form Type: ${formType}`)
            await delay(2000)

            // Verify selections
            const selectedValues = await page.evaluate(() => {
              const fySelect = document.querySelector("#financialYear") as HTMLSelectElement
              const qSelect = document.querySelector("#quarter") as HTMLSelectElement
              const ftSelect = document.querySelector("#formType") as HTMLSelectElement
              return {
                financialYear: fySelect?.value || "NOT SELECTED",
                quarter: qSelect?.value || "NOT SELECTED",
                formType: ftSelect?.value || "NOT SELECTED",
              }
            })
            console.log(`🔍 Verification - Selected values:`, selectedValues)

            // Click Go button
            await page.waitForSelector("#clickGo", { visible: true, timeout: 10000 })
            await page.click("#clickGo")
            console.log("✅ Clicked Go button")

            // Wait for API response
            await delay(6000)

            // Collect all pages of data
            const allPagesData: any[] = []
            let currentPageNumber = 1
            let hasMorePages = true

            while (hasMorePages) {
              console.log(`📄 Processing page ${currentPageNumber}...`)

              // Collect current page data
              if (currentReturnStatusData && currentReturnStatusData.rows) {
                // Check for rejected returns and fetch rejection reasons
                for (const row of currentReturnStatusData.rows) {
                  if (
                    row.status &&
                    row.status.toLowerCase().includes("reject") &&
                    row.reason &&
                    row.reason.toLowerCase().includes("view rejection reason")
                  ) {
                    console.log(`🔍 Found rejected return: ${row.tokenno}, fetching rejection reason...`)
                    
                    try {
                      // Find and click the rejection reason link in the table
                      const clicked = await page.evaluate((tokenno) => {
                        const rows = Array.from(document.querySelectorAll('#stmtFiledStatusTab tr[role="row"]'))
                        for (const tableRow of rows) {
                          const cells = Array.from(tableRow.querySelectorAll('td'))
                          // Check if this row contains the token number
                          const tokenCell = cells.find(cell => cell.textContent?.trim() === tokenno)
                          if (tokenCell) {
                            // Find the "View Rejection Reason" cell
                            const reasonCell = cells.find(cell => 
                              cell.textContent?.toLowerCase().includes('view rejection reason')
                            )
                            if (reasonCell) {
                              (reasonCell as HTMLElement).click()
                              return true
                            }
                          }
                        }
                        return false
                      }, row.tokenno)

                      if (clicked) {
                        console.log(`✅ Clicked rejection reason for ${row.tokenno}`)
                        await delay(3000) // Wait for API call
                        
                        // Store the rejection message with the token number
                        if (currentRejectionMessages.latest) {
                          row.rejectionMsg = currentRejectionMessages.latest
                          currentRejectionMessages.latest = "" // Clear for next iteration
                        }
                      } else {
                        console.log(`⚠️ Could not find rejection reason link for ${row.tokenno}`)
                      }
                    } catch (error) {
                      console.error(`Error fetching rejection reason for ${row.tokenno}:`, error)
                    }
                  }
                }

                // Add current page data
                allPagesData.push(...currentReturnStatusData.rows)
                console.log(`✅ Added ${currentReturnStatusData.rows.length} records from page ${currentPageNumber}`)
              } else {
                console.log(`⚠️ No data received for page ${currentPageNumber}`)
              }

              // Check if next page button is available and not disabled
              const nextPageAvailable = await page.evaluate(() => {
                const nextButton = document.querySelector('#next_pagernav')
                if (!nextButton) return false
                
                // Check if button has ui-state-disabled class
                const isDisabled = nextButton.classList.contains('ui-state-disabled')
                return !isDisabled
              })

              if (nextPageAvailable) {
                console.log(`➡️ Next page available, clicking...`)
                
                // Reset data for next page
                currentReturnStatusData = null
                
                // Click next page button
                await page.evaluate(() => {
                  const nextButton = document.querySelector('#next_pagernav') as HTMLElement
                  if (nextButton) {
                    nextButton.click()
                  }
                })
                
                // Wait for next page to load
                await delay(5000)
                currentPageNumber++
              } else {
                console.log(`✅ No more pages available`)
                hasMorePages = false
              }
            }

            // Add all collected results for this combination
            if (allPagesData.length > 0) {
              allResults.push({
                financialYear,
                quarter,
                formType,
                data: {
                  rows: allPagesData,
                  totalPages: currentPageNumber,
                  totalRecords: allPagesData.length,
                },
              })
              console.log(`✅ Total records collected: ${allPagesData.length} from ${currentPageNumber} page(s)`)
            } else {
              console.log(`⚠️ No data received for this combination`)
            }

            // Reload page for next combination to ensure clean state
            if (
              financialYear !== financialYears[financialYears.length - 1] ||
              quarter !== quarters[quarters.length - 1] ||
              formType !== formTypes[formTypes.length - 1]
            ) {
              console.log("🔄 Reloading page for next combination...")
              await page.goto(traces61DedUrl("stmtstatus.xhtml"), {
                waitUntil: "networkidle2",
                timeout: 60000,
              })
              await delay(3000)
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

    return {
      data: allResults,
    }
  } catch (error) {
    console.error("❌ Error in fetchReturnStatus:", error)
    throw error
  }
}
