import { formatDate } from "./formatter"

export interface CalendarEvent {
  title: string
  description: string
  location?: string
  startTime: Date
  endTime: Date
  organizer: {
    name: string
    email: string
  }
  attendees?: Array<{
    name: string
    email: string
  }>
}

/**
 * Generate an ICS calendar file content for a notice review event
 */
export function generateNoticeReviewICS(
  noticeTitle: string,
  noticeDetails: string,
  companyName: string,
  recipientEmail: string,
  blockingTime?: string // HH:MM format
): string {
  // Set event time based on configured blocking time or default to 11 AM IST
  const eventDate = new Date()

  if (blockingTime) {
    // Parse the HH:MM format and convert to IST
    const timeParts = blockingTime.split(":")
    console.log("timeParts", timeParts)
    if (timeParts.length === 2) {
      const hours = parseInt(timeParts[0] || "0", 10)
      const minutes = parseInt(timeParts[1] || "0", 10)
      console.log("hours", hours)
      console.log("minutes", minutes)
      if (!isNaN(hours) && !isNaN(minutes)) {
        // IST is UTC+5:30, so subtract 5.5 hours to get UTC time
        const utcHours = hours
        const utcMinutes = minutes

        // Handle negative minutes
        if (utcMinutes < 0) {
          eventDate.setHours(utcHours - 1, utcMinutes + 60, 0, 0)
        } else {
          eventDate.setHours(utcHours, utcMinutes, 0, 0)
        }
      } else {
        // Default to 11 AM IST = 5:30 AM UTC if parsing fails
        eventDate.setHours(11, 0, 0, 0)
      }
    } else {
      // Default to 11 AM IST = 5:30 AM UTC if format is invalid
      eventDate.setHours(11, 0, 0, 0)
    }
  } else {
    // Default to 11 AM IST = 5:30 AM UTC
    eventDate.setHours(11, 0, 0, 0)
  }

  const endDate = new Date(eventDate)
  endDate.setHours(endDate.getHours() + 1) // 1 hour meeting

  const event: CalendarEvent = {
    title: `Notice Review: ${noticeTitle}`,
    description: `Please review the following notice details:\n\n${noticeDetails}\n\nCompany: ${companyName}\n\nThis is an automated calendar event for notice review.`,
    location: "Office/Remote",
    startTime: eventDate,
    endTime: endDate,
    organizer: {
      name: "Income Tax Notice System",
      email: "system@noticesystem.com",
    },
    attendees: [
      {
        name: companyName,
        email: recipientEmail,
      },
    ],
  }

  return generateICSFile(event)
}

/**
 * Generate ICS file content from calendar event data
 */
function generateICSFile(event: CalendarEvent): string {
  const formatDateTime = (date: Date): string => {
    return date.toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"
  }

  const uid = `notice-${Date.now()}@${event.organizer.email.split("@")[1]}`
  const now = formatDateTime(new Date())

  let icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Income Tax Notice System//Calendar Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${formatDateTime(event.startTime)}`,
    `DTEND:${formatDateTime(event.endTime)}`,
    `DTSTAMP:${now}`,
    `ORGANIZER;CN=${event.organizer.name}:mailto:${event.organizer.email}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`,
    event.location ? `LOCATION:${event.location}` : "",
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE", // This blocks the time in calendar
    "CLASS:PUBLIC",
  ]

  // Add attendees if any
  if (event.attendees) {
    event.attendees.forEach((attendee) => {
      icsContent.push(`ATTENDEE;CN=${attendee.name};RSVP=TRUE:mailto:${attendee.email}`)
    })
  }

  icsContent.push(
    "BEGIN:VALARM",
    "TRIGGER:-PT15M", // 15 minutes before
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder: Notice Review Meeting",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  )

  return icsContent.filter((line) => line !== "").join("\r\n")
}

/**
 * Create a calendar event for GST notice review
 */
export function generateGstNoticeReviewICS(
  noticeNumber: string,
  gstin: string,
  companyName: string,
  recipientEmail: string,
  blockingTime?: string // HH:MM format
): string {
  const noticeDetails = `GST Notice Review\nNotice Number: ${noticeNumber}\nGSTIN: ${gstin}`

  return generateNoticeReviewICS(
    `GST Notice ${noticeNumber}`,
    noticeDetails,
    companyName,
    recipientEmail,
    blockingTime
  )
}

/**
 * Create a calendar event for IT notice review
 */
export function generateItNoticeReviewICS(
  noticeSection: string,
  assessmentYear: string,
  companyName: string,
  recipientEmail: string,
  blockingTime?: string
): string {
  const noticeDetails = `Income Tax Notice Review\nSection: ${noticeSection}\nAssessment Year: ${assessmentYear}`

  return generateNoticeReviewICS(
    `IT Notice ${noticeSection}`,
    noticeDetails,
    companyName,
    recipientEmail,
    blockingTime
  )
}
