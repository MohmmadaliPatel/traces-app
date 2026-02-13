import { useEffect } from "react"
import { BlitzPage } from "@blitzjs/next"
import "antd/dist/reset.css"
import { useRouter } from "next/router"

const Home: BlitzPage = () => {
  const router = useRouter()

  useEffect(() => {
      void router.push("/conso-files")

  }, [router])

  return null
}

export default Home
