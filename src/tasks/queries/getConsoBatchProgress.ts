import { resolver } from "@blitzjs/rpc"
import { z } from "zod"
import { emptyConsoBatchProgress, loadConsoBatchProgress } from "src/tasks/consoBatchProgress"

const Schema = z.object({
  batchId: z.number().int().positive(),
})

export default resolver.pipe(resolver.zod(Schema), resolver.authorize(), async ({ batchId }) => {
  if (!batchId || batchId <= 0) return emptyConsoBatchProgress(batchId)
  return loadConsoBatchProgress(batchId)
})
