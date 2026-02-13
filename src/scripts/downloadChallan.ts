import puppeteer from "puppeteer-extra"
import fs from "fs"
// add stealth plugin and use defaults (all evasion techniques)
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { Page } from "puppeteer"
import { waitForSecs } from "src/utils/promises"
import path from "path"
puppeteer.use(StealthPlugin())

async function login(page: Page, username: string, password: string) {
  await page.waitForSelector('input[name="panAdhaarUserId"]') // Replace with your button selector
  await waitForSecs(2000)
  await page.type(
    'input[name="panAdhaarUserId"]',
    typeof username === "string" ? username.toUpperCase() : String(username).toUpperCase()
  )
  await page.click(".large-button-primary.width.marTop16")
  await page.waitForSelector("#passwordCheckBox-input") // Replace with your button selector
  await page.click("#passwordCheckBox-input")
  await page.type('input[name="loginPasswordField"]', password)
  await waitForSecs(5000)
  await page.click(".large-button-primary.width.marTop26")
  try {
    await waitForSecs(5000)
    const loginHereElement = await page.$("::-p-xpath(//button[text()=' Login Here '])")
    if (loginHereElement) {
      ;(loginHereElement as any).click()
    }
  } catch (error) {}
}

export async function downloadChallans(
  Username: string,
  Password: string,
  companyName: string,
  downloadCount?: number
) {
  console.log("USERNAME", Username)
  console.log("PASSWORD", Password)
  console.log("COMPANY NAME", companyName)
  console.log("NUMBER OF CHALLANS TO DOWNLOAD:", downloadCount)

  // Launch a headless browser
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      "--start-maximized", // you can also use '--start-fullscreen'
    ],
  })

  // Open a new page
  const page = await browser.newPage()

  // Set the download behavior to use the custom download path
  const downloadPath = path.resolve(`./public/pdf/challans/${companyName}/GeneratedChallans`)
  const client = await page.createCDPSession()
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }
  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath,
  })

  // Navigate to a website
  await page.goto("https://eportal.incometax.gov.in/iec/foservices/#/login")

  // Click a button that triggers XHR requests
  await login(page, Username, Password)

  await page.evaluate(() => {
    setTimeout(() => {
      location.href = "#/dashboard/e-pay-tax/e-pay-tax-dashboard"
      setTimeout(() => {
        window["$"]("#securityReasonPopup").modal("hide")
      }, 1000)
    }, 5000)
  })
  await page.waitForSelector(".mdc-tab__text-label")
  const elements = await page.$$(".mdc-tab__text-label")

  // The original click might not work due to detached DOM or shadow roots.
  // We'll re-query for the tab using explicit selector and evaluate click directly in the browser context.
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".mdc-tab__text-label"))
    for (const el of tabs) {
      if (el.textContent?.trim() === "Generated Challans") {
        // Sometimes direct click doesn't work if events are not normal. Try dispatching MouseEvent.
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))
        break
      }
    }
  })

  await waitForSecs(5000)
  await page.waitForSelector("ag-grid-angular .ag-row.ag-row-first")
  await page.evaluate(() => {
    ;[...Array.from(document.querySelectorAll("ag-grid-angular .ag-row.ag-row-first"))].forEach(
      (e) => {
        e.children[e.children.length - 1]?.scrollIntoView()
      }
    )
  })

  await page.evaluate(async (downloadCount) => {
    function waitForSecs(timeout = 5000) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(true)
        }, timeout)
      })
    }

    // Get all rows from the grid (they should be sorted by creation date, most recent first)
    const rows = Array.from(document.querySelectorAll("ag-grid-angular .ag-row"))

    // Determine how many to download
    const countToDownload = downloadCount && downloadCount > 0 ? downloadCount : rows.length

    console.log(`Found ${rows.length} total rows, will download ${countToDownload}`)

    // Download the first N rows (most recent challans)
    for (let i = 0; i < Math.min(countToDownload, rows.length); i++) {
      const row = rows[i]
      if (!row) continue

      console.log(`Downloading challan ${i + 1} of ${countToDownload}`)

      // Find the action button for this specific row
      const actionButton = row.querySelector(
        "app-e-pay-tax-actions .mat-mdc-icon-button"
      ) as any
      if (actionButton) {
        actionButton.click()
        await waitForSecs(500)
        ;(document.querySelector(".mat-mdc-menu-item.mat-focus-indicator") as any)?.click()
        await waitForSecs(5000)
      }
    }

    console.log(`Completed downloading ${countToDownload} challans`)
  }, downloadCount)
  browser.close()
}
