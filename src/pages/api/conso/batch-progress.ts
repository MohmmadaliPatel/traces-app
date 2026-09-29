import type { NextApiRequest, NextApiResponse } from "next"
import { withApiAuth } from "src/shared/http"
import { loadConsoBatchProgress } from "src/tasks/consoBatchProgress"
import { subscribeBatchProgress } from "src/shared/jobs/batchProgressBus"

export const config = {
  api: {
    bodyParser: false,
  },
}

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  const batchId = Number(req.query.batchId)
  if (!Number.isInteger(batchId) || batchId <= 0) {
    res.status(400).json({ error: "Invalid batchId" })
    return
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  })
  res.flushHeaders?.()

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  send(await loadConsoBatchProgress(batchId))

  const unsubscribe = subscribeBatchProgress(batchId, (progress) => {
    send(progress)
  })

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n")
  }, 25000)

  const cleanup = () => {
    clearInterval(keepAlive)
    unsubscribe()
  }

  req.on("close", cleanup)
  req.on("end", cleanup)
})
