import { resolver } from "@blitzjs/rpc"
import { z } from "zod"
import { readFile, writeFile } from "fs/promises"
import { parse, stringify } from "envfile"

const SaveConfig = z.object({
  LICENSE: z.string(),
  MACHINE_ID: z.string(),
})

export default resolver.pipe(resolver.zod(SaveConfig), async ({ LICENSE, MACHINE_ID }) => {
  const existingENV = parse(await readFile(".env.production", "utf-8"))
  await writeFile(".env.production", stringify({ ...existingENV, LICENSE, MACHINE_ID }))
  process.env["LICENSE"] = LICENSE
  process.env["MACHINE_ID"] = MACHINE_ID
  return {
    success: true,
  }
})
