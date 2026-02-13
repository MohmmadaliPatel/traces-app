import db from "db"
import sendMail from "src/mailer/sendMail"
import fs from "fs"
import path from "path"
import nodemailer, { Transporter } from "nodemailer"

/**
 * Send Form 16A email with PDF attachment
 * @param pan - PAN number of the deductee
 * @param pdfPath - Full path to the PDF file
 * @param financialYear - Financial year (e.g., "2025-26")
 * @param quarter - Quarter (e.g., "Q1", "Q2")
 * @param formType - Form type (e.g., "FORM16A")
 */
export async function sendForm16AEmail(
  pan: string,
  pdfPath: string,
  financialYear: string,
  quarter: string,
  formType: string = "FORM16A"
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Find email from master table
    const deducteeMaster = await db.deducteeMaster.findUnique({
      where: { pan: pan.toUpperCase() },
    })

    if (!deducteeMaster) {
      return {
        success: false,
        error: `No email found for PAN: ${pan}. Please add this PAN to the master table.`,
      }
    }

    if (!deducteeMaster.email || deducteeMaster.email.trim() === "") {
      return {
        success: false,
        error: `Email is empty for PAN: ${pan}`,
      }
    }

    // 2. Get active SMTP configuration
    const smtpConfig = await db.smtpConfig.findFirst({
      where: { isActive: true },
    })

    if (!smtpConfig) {
      return {
        success: false,
        error: "No active SMTP configuration found. Please configure SMTP settings.",
      }
    }

    // 3. Check if PDF file exists
    if (!fs.existsSync(pdfPath)) {
      return {
        success: false,
        error: `PDF file not found: ${pdfPath}`,
      }
    }

    // 4. Read PDF file as buffer
    const pdfBuffer = fs.readFileSync(pdfPath)
    const pdfBase64 = pdfBuffer.toString("base64")

    // 5. Create email subject and body
    // Extract quarter number (e.g., "Q2" -> "2")
    const quarterNumber = quarter.replace(/[^0-9]/g, "")
    const subject = `TDS Certificates for Quarter ${quarterNumber} of Financial Year ${financialYear}`
    const body = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <p>Hi,</p>
            <p>Please find herewith TDS Certificates for Quarter ${quarterNumber} of Financial Year ${financialYear}</p>
          </div>
        </body>
      </html>
    `

    // 6. Create custom transporter with database SMTP config
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.password,
      },
      pool: true,
    })

    // 7. Send email
    const mailOptions = {
      from: smtpConfig.fromEmail,
      to: deducteeMaster.email,
      subject: subject,
      html: body,
      attachments: [
        {
          filename: path.basename(pdfPath),
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    }

    await transporter.sendMail(mailOptions)

    // 8. Log email sent
    await db.emailLog.create({
      data: {
        pan: pan.toUpperCase(),
        email: deducteeMaster.email,
        subject: subject,
        status: "sent",
        pdfPath: pdfPath,
        financialYear: financialYear,
        quarter: quarter,
        formType: formType,
      },
    })

    return { success: true }
  } catch (error: any) {
    // Log failed email
    try {
      // Extract quarter number (e.g., "Q2" -> "2")
      const quarterNumber = quarter.replace(/[^0-9]/g, "")
      await db.emailLog.create({
        data: {
          pan: pan.toUpperCase(),
          email: "",
          subject: `TDS Certificates for Quarter ${quarterNumber} of Financial Year ${financialYear}`,
          status: "failed",
          errorMessage: error.message || "Unknown error",
          pdfPath: pdfPath,
          financialYear: financialYear,
          quarter: quarter,
          formType: formType,
        },
      })
    } catch (logError) {
      console.error("Failed to log email error:", logError)
    }

    return {
      success: false,
      error: error.message || "Failed to send email",
    }
  }
}
