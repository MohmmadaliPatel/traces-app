import fs from "fs/promises"
import mime from "mime-types"
import path from "path"

export default async function handler(req, res) {
  console.log("idhar aaya")
  const filePath = path.resolve(".", `public/${req.query.slug.join("/")}`)
  const buffer = await fs.readFile(filePath)
  res.setHeader("Content-Type", mime.lookup(filePath))
  return res.send(buffer)
}
