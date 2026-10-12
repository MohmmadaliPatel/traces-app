import { enhancePrisma } from "blitz"
import { PrismaClient } from "@prisma/client"
import { credentialEncryptionMiddleware } from "./credentialEncryption"

const EnhancedPrisma = enhancePrisma(PrismaClient)

export * from "@prisma/client"
export { MASKED_SECRET, maskCompanySecrets } from "./credentialEncryption"
const db = new EnhancedPrisma()
// Company.password / it_password are encrypted at rest; see credentialEncryption.ts
db.$use(credentialEncryptionMiddleware as Parameters<typeof db.$use>[0])
export default db
