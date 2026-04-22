import puppeteer from "puppeteer"
import path from "path"
import os from "os"
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

export async function fetchOutstandingDemand({
  credentials,
}: {
  credentials: { userId: string; password: string; tan: string }
}): Promise<{ data: any; priorYearsData?: any }> {
  try {
    console.log("🚀 Starting Outstanding Demand fetch...")
    const page = await loginToTdsPortal(credentials)

    let demandData: any = null
    let priorYearsData: any = null
    let hasPriorYears = false

    // Set up request interception BEFORE navigating to the page
    console.log("🔍 Setting up request interception...")
    await page.setRequestInterception(true)

    // Listen for ALL API responses (including initial page load and prior years)
    page.on("response", async (response: any) => {
      const url = response.url()
      
      // Capture initial demand data (reqtype=0)
      if (url.includes("TagChallanServlet?reqtype=0")) {
        try {
          const data = await response.json()
          console.log("✅ Received demand data:", data)
          demandData = data
          
          // Check if there's a "Prior Years" entry (fin: 1)
          if (data.rows && data.rows.some((row: any) => row.fin === 1)) {
            hasPriorYears = true
            console.log("📋 Prior Years detected in response")
          }
        } catch (error) {
          console.error("Error parsing demand data:", error)
        }
      }
      
      // Capture prior years data (TagChallanServlet without reqtype=0)
      else if (url.includes("TagChallanServlet") && !url.includes("reqtype=0")) {
        try {
          const data = await response.json()
          console.log("✅ Received prior years data:", data)
          priorYearsData = data
        } catch (error) {
          console.error("Error parsing prior years data:", error)
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

    // Navigate to outstanding demand page (API will be called on page load)
    console.log("📄 Navigating to Outstanding Demand page...")
    await page.goto(traces61DedUrl("outstandingdemand.xhtml"), {
      waitUntil: "networkidle2",
      timeout: 60000,
    })

    // Wait for initial API call to complete
    await delay(3000)

    // If there are prior years, click on it to expand
    if (hasPriorYears && demandData) {
      console.log("📋 Clicking on Prior Years to expand...")
      
      try {
        // Click on "Prior Years" row
        const priorYearsClicked = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('tr[role="row"]'))
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'))
            for (const cell of cells) {
              if (cell.textContent?.includes("Prior Years")) {
                ;(cell as HTMLElement).click()
                return true
              }
            }
          }
          return false
        })

        if (priorYearsClicked) {
          console.log("✅ Clicked on Prior Years, waiting for API response...")
          // Wait for prior years API call to complete
          await delay(5000)
        } else {
          console.log("⚠️ Could not find Prior Years row to click")
        }
      } catch (error) {
        console.error("Error expanding prior years:", error)
      }
    }

    return {
      data: demandData,
      priorYearsData: priorYearsData,
    }
  } catch (error) {
    console.error("❌ Error in fetchOutstandingDemand:", error)
    throw error
  }
}
