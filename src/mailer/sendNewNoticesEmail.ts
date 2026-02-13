import createNoticeTable, {
  createGstAdditionalNoticeTable,
  createGstNoticeTable,
  GstAdditionalNoticeData,
  GstNoticeData,
  NoticeData,
} from "./createNoticeTable"
import sendMail from "./sendMail"
import { generateItNoticeReviewICS, generateGstNoticeReviewICS } from "../utils/calendar"

export default async function sendNewNoticesEmail(
  to: string,
  data: NoticeData,
  includeCalendar: boolean = true,
  blockingTime?: string
) {
  console.log(`📧 Preparing to send email to: ${to} with ${data?.length || 0} notices`)

  // Validate email address
  if (!to || typeof to !== "string" || !to.includes("@")) {
    console.error(`❌ Invalid email address: ${to}`)
    throw new Error(`Invalid email address provided: ${to}`)
  }

  // Validate data
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.error(`❌ Invalid or empty notice data for email: ${to}`, data)
    throw new Error(`No valid notice data provided for email: ${to}`)
  }

  try {
    const htmlContent = createNoticeTable(data)
    console.log(`✅ Email template created successfully for: ${to}`)

    // Prepare calendar attachments if requested
    let attachments: Array<{ filename: string; content: string; contentType: string }> = []

    if (includeCalendar && data.length > 0) {
      try {
        const firstNotice = data[0]
        if (!firstNotice) {
          console.warn(`⚠️ No valid notice data for calendar generation for ${to}`)
        } else {
          const companyName = firstNotice.Assessee || "Unknown Company"
          const noticeSection = firstNotice["Notice Section"] || "Unknown Section"
          const assessmentYear = firstNotice["Assessment Year"] || "Unknown Year"

          const calendarContent = generateItNoticeReviewICS(
            noticeSection,
            assessmentYear,
            companyName,
            to,
            blockingTime
          )

          attachments.push({
            filename: "notice-review.ics",
            content: calendarContent,
            contentType: "text/calendar; charset=utf-8; method=REQUEST",
          })

          console.log(`📅 Calendar invitation generated for: ${to}`)
        }
      } catch (calendarError) {
        console.warn(`⚠️ Failed to generate calendar invitation for ${to}:`, calendarError)
        // Continue without calendar if generation fails
      }
    }

    const result = await sendMail(
      to,
      "The income-tax department has issued new notices",
      htmlContent,
      attachments
    )
    console.log(`✅ Email sent successfully to: ${to}`)

    return result
  } catch (error) {
    console.error(`❌ Failed to send email to: ${to}`, error)
    throw error
  }
}

export async function sendNewGstNoticesEmail(
  to: string,
  data: any,
  includeCalendar: boolean = true,
  blockingTime?: string
) {
  console.log(`📧 Preparing to send GST email to: ${to} with ${data?.length || 0} notices`)

  try {
    const htmlContent = createGstNoticeTable(data)
    console.log(`✅ GST Email template created successfully for: ${to}`)

    // Prepare calendar attachments if requested
    let attachments: Array<{ filename: string; content: string; contentType: string }> = []

    if (includeCalendar && data.length > 0) {
      try {
        const firstNotice = data[0]
        if (!firstNotice) {
          console.warn(`⚠️ No valid GST notice data for calendar generation for ${to}`)
        } else {
          const companyName = firstNotice.Assessee || "Unknown GST Company"
          const gstin = firstNotice.GSTIN || "Unknown GSTIN"
          const noticeNumber = firstNotice["Notice Number"] || "Unknown Notice"

          const calendarContent = generateGstNoticeReviewICS(
            noticeNumber,
            gstin,
            companyName,
            to,
            blockingTime
          )

          attachments.push({
            filename: "gst-notice-review.ics",
            content: calendarContent,
            contentType: "text/calendar; charset=utf-8; method=REQUEST",
          })

          console.log(`📅 GST Calendar invitation generated for: ${to}`)
        }
      } catch (calendarError) {
        console.warn(`⚠️ Failed to generate GST calendar invitation for ${to}:`, calendarError)
        // Continue without calendar if generation fails
      }
    }

    const result = await sendMail(
      to,
      "The GST department has issued new notices",
      htmlContent,
      attachments
    )
    console.log(`✅ GST Email sent successfully to: ${to}`)

    return result
  } catch (error) {
    console.error(`❌ Failed to send GST email to: ${to}`, error)
    throw error
  }
}

export async function sendNewGstAdditionalNoticeEmail(to: string, data: GstAdditionalNoticeData) {
  const htmlContent = createGstAdditionalNoticeTable(data)
  return sendMail(to, "The GST department has issued new additional notices", htmlContent)
}
