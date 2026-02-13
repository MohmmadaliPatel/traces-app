import { NextApiRequest, NextApiResponse } from "next"
import nodemailer from "nodemailer"

/**
 * API endpoint to test SMTP connection
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { host, port, secure, user, password } = req.body

    if (!host || !port || !user || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required SMTP configuration parameters",
      })
    }

    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure,
      auth: {
        user,
        pass: password,
      },
    })

    await transporter.verify()

    return res.status(200).json({
      success: true,
      message: "SMTP connection test successful!",
    })
  } catch (error: any) {
    console.error("SMTP test error:", error)
    return res.status(500).json({
      success: false,
      message: `SMTP connection test failed: ${error.message}`,
    })
  }
}
