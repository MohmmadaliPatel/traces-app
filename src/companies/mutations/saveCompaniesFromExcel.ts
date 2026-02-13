import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const CompanyDataSchema = z.object({
  name: z.string(),
  tan: z.string(),
  it_password: z.string(),
  user_id: z.string(),
  password: z.string(),
})

const SaveCompaniesFromExcelSchema = z.object({
  companies: z.array(CompanyDataSchema),
  isTemporary: z.boolean().default(false),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(SaveCompaniesFromExcelSchema),
  async ({ companies, isTemporary }) => {
    const savedCompanies:any = []
    const updatedCompanies:any = []
    const errors:any = []

    for (const company of companies) {
      try {
        // Check if company already exists (by TAN)
        const existingCompany = await db.company.findUnique({
          where: { tan: company.tan.toUpperCase() },
        })

        if (existingCompany) {
          // Update existing company
          const updated = await db.company.update({
            where: { tan: company.tan.toUpperCase() },
            data: {
              name: company.name,
              it_password: company.it_password,
              user_id: company.user_id,
              password: company.password,
              isTemporary: isTemporary,
            },
          })
          updatedCompanies.push(updated)
        } else {
          // Create new company
          const created = await db.company.create({
            data: {
              name: company.name,
              tan: company.tan.toUpperCase(),
              it_password: company.it_password,
              user_id: company.user_id,
              password: company.password,
              isTemporary: isTemporary,
              emails: "",
            },
          })
          savedCompanies.push(created)
        }
      } catch (error: any) {
        errors.push({
          company: company.name,
          tan: company.tan,
          error: error.message || "Failed to save company",
        })
      }
    }

    return {
      saved: savedCompanies.length,
      updated: updatedCompanies.length,
      errors: errors.length,
      errorDetails: errors,
      total: companies.length,
    }
  }
)
