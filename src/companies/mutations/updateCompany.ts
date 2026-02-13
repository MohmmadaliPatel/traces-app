import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const UpdateCompanySchema = z.object({
  id: z.number(),
  data: z.object({
    name: z.string().min(1, "Company name is required"),
    tan: z.string().length(10, "TAN must be 10 characters"),
    it_password: z.string().min(1, "IT password is required"),
    user_id: z.string().min(1, "User ID is required"),
    password: z.string().min(1, "Password is required"),
  }),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(UpdateCompanySchema),
  async ({ id, data }) => {
    const company = await db.company.findUnique({
      where: { id },
    })

    if (!company) {
      throw new Error("Company not found")
    }

    const updatedCompany = await db.company.update({
      where: { id },
      data: {
        name: data.name,
        tan: data.tan.toUpperCase(),
        it_password: data.it_password,
        user_id: data.user_id,
        password: data.password,
      },
    })

    return {
      success: true,
      message: "Company updated successfully",
      company: updatedCompany,
    }
  }
)
