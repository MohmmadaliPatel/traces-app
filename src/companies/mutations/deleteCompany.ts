import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const DeleteCompanySchema = z.object({
  id: z.number(),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(DeleteCompanySchema),
  async ({ id }) => {
    const company = await db.company.findUnique({
      where: { id },
    })

    if (!company) {
      throw new Error("Company not found")
    }

    await db.company.delete({
      where: { id },
    })

    return { success: true, message: "Company deleted successfully" }
  }
)
