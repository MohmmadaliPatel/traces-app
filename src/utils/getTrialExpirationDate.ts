import WinReg from "winreg"

export const isTrial = true

// Define registry key and value names
const REGISTRY_KEY = "\\Software\\Traces Conso"
const INSTALL_DATE_VALUE = "InstallDate"
const TRIAL_PERIOD_DAYS = 180 // 6 months

// Function to get the installation date from the registry
function getInstallDate(): Promise<Date> {
  return new Promise((resolve, reject) => {
    const regKey = new WinReg({
      hive: WinReg.HKCU,
      key: REGISTRY_KEY,
    })
    regKey.get(INSTALL_DATE_VALUE, (err, item) => {
      if (err || !item.value) {
        reject(new Error("Installation date not found"))
      } else {
        console.log(item.value)

        resolve(new Date(item.value))
      }
    })
  })
}

// Function to calculate trial expiration date
export async function getTrialExpirationDate() {
  try {
    const expirationDate = await getInstallDate()
    expirationDate.setDate(expirationDate.getDate() + TRIAL_PERIOD_DAYS)
    return expirationDate
  } catch (error) {}
}
