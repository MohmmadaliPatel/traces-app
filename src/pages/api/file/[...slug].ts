import { withApiAuth } from "src/utils/apiAuth"
import fs from "fs/promises"
import mime from "mime-types"
import path from "path"

export default withApiAuth(async (req, res, _ctx) => {
  console.log("idhar aaya")
  const filePath = path.resolve(".", `public/${req.query.slug.join("/")}`)
  const buffer = await fs.readFile(filePath)
  res.setHeader("Content-Type", mime.lookup(filePath))
  return res.send(buffer)
})
