import nodemailer, { Transporter } from "nodemailer"

let transporter: Transporter | null = null

export default async function sendMail(
  to: string,
  subject: string,
  html: string,
  attachments?: Array<{ filename: string; content: string; contentType: string }>
) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_PORT ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD
  ) {
    console.log("SMTP not configured")
    return
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, // SMTP server
      port: Number(process.env.SMTP_PORT), // Port for SSL/TLS
      secure: process.env.SMTP_SECURE === "false" ? false : true || true, // Use SSL/TLS
      auth: {
        user: process.env.SMTP_USER, // SMTP username
        pass: process.env.SMTP_PASSWORD, // SMTP password
      },
      pool: true, // Enable connection pooling
    })
  }

  const mailOptions: any = {
    from: process.env.FROM_EMAIL,
    to,
    subject,
    html,
  }

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    }))
  }

  return transporter.sendMail(mailOptions)
}
