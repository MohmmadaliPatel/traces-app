import React, { createContext, useContext, useState, useEffect } from "react"

// Define the structure of the notification counts
type NotificationCounts = {
  assessee: number
  proceedings: number
  calendar: number
  notices: number
  gstNotices: number
  additionalNoticesNotice: number
  additionalNoticesCase: number
  demands: number
  itrs: number
  logs: number
  settings: number
}

// Set default values for notification counts
const defaultNotificationCounts: NotificationCounts = {
  assessee: 0,
  proceedings: 0,
  calendar: 0,
  notices: 0,
  gstNotices: 0,
  additionalNoticesNotice: 0,
  additionalNoticesCase: 0,
  demands: 0,
  itrs: 0,
  logs: 0,
  settings: 0,
}

// Utility to check if window is defined (to confirm we are in the browser)
const isBrowser = typeof window !== "undefined"

// Utility to get data from sessionStorage, only in the browser
const getStoredNotificationCounts = (): NotificationCounts => {
  if (!isBrowser) {
    return defaultNotificationCounts // Return default if not in the browser
  }
  const storedCounts = sessionStorage.getItem("notificationCounts")
  return storedCounts ? JSON.parse(storedCounts) : defaultNotificationCounts
}

// Create the context
const NotificationContext = createContext({
  notificationCounts: defaultNotificationCounts,
  setNotificationCounts: (counts: NotificationCounts) => {},
})

// Create a provider component
export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize state with values from sessionStorage (only on client-side)
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts>(() =>
    getStoredNotificationCounts()
  )

  // Effect to update sessionStorage whenever notificationCounts changes (client-side only)
  useEffect(() => {
    if (isBrowser) {
      sessionStorage.setItem("notificationCounts", JSON.stringify(notificationCounts))
    }
  }, [notificationCounts])

  return (
    <NotificationContext.Provider value={{ notificationCounts, setNotificationCounts }}>
      {children}
    </NotificationContext.Provider>
  )
}

// Create a hook to access the context
export const useNotification = () => {
  return useContext(NotificationContext)
}
