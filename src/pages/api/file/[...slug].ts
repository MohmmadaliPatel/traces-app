import { withApiAuth } from "src/utils/apiAuth"
import fs from "fs/promises"
import mime from "mime-types"
import path from "path"

export default withApiAuth(async (req, res, _ctx) => {
  console.log("idhar aaya")
  const slug = req.query.slug
  if (!slug) {
    return res.status(400).json({ message: "Missing file path" })
  }

  const slugParts = Array.isArray(slug) ? slug : [slug]
  const filePath = path.resolve(".", `public/${slugParts.join("/")}`)
  const buffer = await fs.readFile(filePath)
  const contentType = mime.lookup(filePath) || "application/octet-stream"
  res.setHeader("Content-Type", contentType)
  return res.send(buffer)
})
