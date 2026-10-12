/**
 * Encryption at rest for portal credentials stored on Company (TRACES `password`, Income Tax
 * `it_password`).
 *
 * A Prisma middleware encrypts these fields on every Company write and decrypts them on every
 * read (including companies nested in other queries), so code that logs in to the portals keeps
 * reading plain values while the database only ever holds ciphertext.
 *
 * Values are AES-256-GCM: "enc:v1:<iv>:<tag>:<ciphertext>" (base64). The key comes from
 * CREDENTIALS_ENCRYPTION_KEY (32 bytes, base64 or hex); keep it out of git (.env.local) and
 * the same on every server that shares the database. Without the key, stored passwords cannot
 * be recovered.
 *
 * The browser never gets real values: resolvers return MASKED_SECRET instead (maskCompanySecrets),
 * and a write that sends MASKED_SECRET back keeps the stored value.
 */
import crypto from "crypto"

const PREFIX = "enc:v1:"
export const SECRET_FIELDS = ["password", "it_password"] as const
/** Placeholder sent to the browser instead of a stored password. */
export const MASKED_SECRET = "••••••••"

let cachedKey: { raw: string; key: Buffer } | null = null
function getKey(): Buffer {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    // CLI scripts often load only .env; the key lives in .env.local (never overrides set vars)
    try {
      require("dotenv").config({ path: require("path").join(process.cwd(), ".env.local") })
    } catch {
      // not available: fall through to the error below
    }
  }
  const raw = (process.env.CREDENTIALS_ENCRYPTION_KEY || "").trim()
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Add it to .env.local (32 random bytes, base64) on every server that uses this database."
    )
  }
  if (cachedKey?.raw === raw) return cachedKey.key
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64")
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (base64 or hex)")
  cachedKey = { raw, key }
  return key
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX)
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`
}

export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) return value
  const [iv, tag, data] = value.slice(PREFIX.length).split(":")
  if (!iv || !tag || data === undefined) throw new Error("Malformed encrypted credential")
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype

/** Replace stored secrets in any (nested) result with plain values. */
export function decryptDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = decryptDeep(value[i])
    return value
  }
  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>
    for (const [k, v] of Object.entries(obj)) {
      if ((SECRET_FIELDS as readonly string[]).includes(k) && isEncryptedSecret(v)) obj[k] = decryptSecret(v)
      else if (v && typeof v === "object") obj[k] = decryptDeep(v)
    }
  }
  return value
}

/** Copy of a company (or list / nested result) with secrets replaced by MASKED_SECRET, for responses to the browser. */
export function maskCompanySecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(maskCompanySecrets) as unknown as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = (SECRET_FIELDS as readonly string[]).includes(k) && typeof v === "string" && v ? MASKED_SECRET : maskCompanySecrets(v)
    }
    return out as T
  }
  return value
}

function encryptData(data: unknown, allowMasked: boolean) {
  if (!isPlainObject(data)) return
  for (const field of SECRET_FIELDS) {
    let v = data[field]
    const isSetOp = isPlainObject(v) && "set" in v
    if (isSetOp) v = (v as { set: unknown }).set
    if (typeof v !== "string") continue
    if (v === MASKED_SECRET) {
      // The browser sent back the placeholder: keep the stored value
      if (!allowMasked) throw new Error(`Cannot save company ${field}: received the masked placeholder instead of a password`)
      delete data[field]
      continue
    }
    if (v && !isEncryptedSecret(v)) data[field] = encryptSecret(v)
  }
}

type MiddlewareParams = { model?: string; action: string; args: any }

/** Prisma middleware: encrypt Company secrets on write, decrypt secrets in every result. */
export async function credentialEncryptionMiddleware(
  params: MiddlewareParams,
  next: (params: MiddlewareParams) => Promise<unknown>
) {
  if (params.model === "Company" && params.args) {
    const a = params.args
    switch (params.action) {
      case "create":
        encryptData(a.data, false)
        break
      case "createMany":
        ;(Array.isArray(a.data) ? a.data : [a.data]).forEach((d: unknown) => encryptData(d, false))
        break
      case "update":
      case "updateMany":
        encryptData(a.data, true)
        break
      case "upsert":
        encryptData(a.create, false)
        encryptData(a.update, true)
        break
    }
  }
  return decryptDeep(await next(params))
}
