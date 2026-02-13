import { resolver } from "@blitzjs/rpc"
import { getTrialExpirationDate } from "src/utils/getTrialExpirationDate"

export default resolver.pipe(async () => {
  return {
    trialExpDate: await getTrialExpirationDate(),
  }
})
