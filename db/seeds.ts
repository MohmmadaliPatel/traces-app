import { SecurePassword } from "@blitzjs/auth"
import db from "./index"

/*
 * This seed function is executed when you run `blitz db seed`.
 *
 * Probably you want to use a library like https://chancejs.com
 * to easily generate realistic data.
 */
const seed = async () => {
  // for (let i = 0; i < 5; i++) {
  //   await db.project.create({ data: { name: "Project " + i } })
  // }
  const hashedPassword = await SecurePassword.hash("1234567890")

  await db.user.upsert({
    where: { email: "admin@taxteck.com" },
    create: { email: "admin@taxteck.com", hashedPassword, role: "ADMIN" },
    update: { email: "admin@taxteck.com", hashedPassword, role: "ADMIN" },
  })
}

export default seed