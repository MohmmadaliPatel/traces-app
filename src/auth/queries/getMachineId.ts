import { resolver } from "@blitzjs/rpc"
import { getMachineIdWithFallack } from "src/utils/machineid"

export default resolver.pipe(async () => {
  return {
    machineId: await getMachineIdWithFallack(),
  }
})
