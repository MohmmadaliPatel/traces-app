import { z } from "zod"

/** Canonical company credential row used across Excel uploads and batch jobs. */
export type CompanyCredentials = {
  name: string
  tan: string
  it_password: string
  user_id: string
  password: string
}

export const CompanyCredentialsSchema = z.object({
  name: z.string(),
  tan: z.string(),
  it_password: z.string(),
  user_id: z.string(),
  password: z.string(),
})

export const COMPANY_CREDENTIAL_HEADERS = [
  "Company Name",
  "Tan",
  "IT Password",
  "User ID",
  "Password",
] as const

export const COMPANY_CREDENTIAL_COLUMN_MAP = {
  name: "Company Name",
  tan: "Tan",
  it_password: "IT Password",
  user_id: "User ID",
  password: "Password",
} as const
