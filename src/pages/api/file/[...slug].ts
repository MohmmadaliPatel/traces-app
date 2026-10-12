import { withApiAuth } from "src/shared/http"
import fs from "fs/promises"
import mime from "mime-types"
import path from "path"

export default withApiAuth(async (req, res, _ctx) => {
  const slug = req.query.slug
  if (!slug) {
    return res.status(400).json({ message: "Missing file path" })
  }

  const slugParts = Array.isArray(slug) ? slug : [slug]
  const publicDir = path.resolve(".", "public")
  const filePath = path.resolve(publicDir, slugParts.join("/"))
  // Only serve files inside public/ — reject ../ traversal to .env, the database, etc.
  if (!filePath.startsWith(publicDir + path.sep)) {
    return res.status(400).json({ message: "Invalid file path" })
  }
  let buffer: Buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch {
    return res.status(404).json({ message: "File not found" })
  }
  const contentType = mime.lookup(filePath) || "application/octet-stream"
  res.setHeader("Content-Type", contentType)
  return res.send(buffer)
})
