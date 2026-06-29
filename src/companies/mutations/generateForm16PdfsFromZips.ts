import { resolver } from "@blitzjs/rpc"
import { z } from "zod"
import { generatePdfsFromZipFolder } from "src/utils/processZipsForForm16"

const GenerateForm16PdfsFromZipsSchema = z.object({
  sourceFolder: z.string().min(3, "Source folder path is required"),
  companyName: z.string().min(1, "Company name is required"),
  tan: z.string().min(5, "TAN (ZIP password) is required"),
  financialYear: z.string().min(4),
  quarter: z.string().min(2),
  formType: z.string().min(2),
  form16Type: z.enum(["form16", "form16a"]),
  /** Skip PDFs that already exist in the output folder (default true). */
  skipExisting: z.boolean().optional(),
})

export default resolver.pipe(
  resolver.zod(GenerateForm16PdfsFromZipsSchema),
  resolver.authorize(),
  async (input, ctx) => {
    const logLines: string[] = []
    const logger = (msg: string) => {
      console.log(`[ZIP->PDF] ${msg}`)
      logLines.push(msg)
    }

    const result = await generatePdfsFromZipFolder({
      ...input,
      skipExisting: input.skipExisting !== false,
      logger,
    })

    return {
      ...result,
      logs: logLines,
    }
  }
)
