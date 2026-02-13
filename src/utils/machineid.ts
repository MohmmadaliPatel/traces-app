import { machineId } from "node-machine-id"

export const getMachineIdWithFallack = async () => {
  try {
    const id = await machineId()

    return id || process.env.MACHINE_ID
  } catch (error) {
    console.log(error)
    return process.env.MACHINE_ID!
  }
}
