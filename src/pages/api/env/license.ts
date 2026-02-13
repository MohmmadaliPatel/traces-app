import { NextApiRequest, NextApiResponse } from "next"
import * as jose from "jose"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const publicKey = `-----BEGIN PUBLIC KEY-----
    MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqvLhCXHNo7QZxg7w8O0b
    Vr8s7UiQ+SCy3bIVuWjUsLeeL12GRovYScDQXv5VryaEDnFwTwHJKxtzMGYfZfJP
    /mPl/z3ie3PJlOvEkMJf38ZthPAZTkaVUd54R1quhbZVPTihJerZxnCs8PQk5rwf
    oQmyexZJ9uIwR2kDlW27RD7be5v8kZsnyOOoKIPBa9Nxz819q+/1kaB9J2xvs8SM
    DZBKcrdqHy3zoqXiNZy9Q0fpLB/X47MEQcChSyZsp7AP59hq8R6eu2oRip9dtdIx
    ZjuU6M5ddQGsJOoS+IsvxMNdy0f26jmTQFMfhwEzNUdmhEV/URmG2st0UvmfztJT
    4QIDAQAB
    -----END PUBLIC KEY-----`
    const alg = "RS256"
    const publicKeyParsed = await jose.importSPKI(publicKey, alg)

    const licenseKey = process.env.LICENSE || "default_license_key"

    const { payload } = await jose.jwtVerify(licenseKey!, publicKeyParsed)
    console.log(payload)
    res.status(200).json({ moduleAccess: payload.module, expiresAt: payload.exp, machineId: payload.machineId })
  } else {
    res.status(405).json({ message: "Method Not Allowed" })
  }
}
