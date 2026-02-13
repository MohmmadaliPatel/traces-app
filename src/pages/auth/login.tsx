import { BlitzPage } from "@blitzjs/next"
import Layout from "src/core/layouts/Layout"
import { LoginForm } from "src/auth/components/LoginForm"
import { useRouter } from "next/router"

const LoginPage: BlitzPage = () => {
  const router = useRouter()

  return (
    <LoginForm
      onSuccess={(_user) => {
        const next = router.query.next
          ? decodeURIComponent(router.query.next as string)
          : "/conso-files"
        return router.push(next)
      }}
    />
  )
}

export default LoginPage


/*
USERNAME MUMC24640A
PASSWORD Infinity@2017
ASSESSMENT YEAR 2026-27
SECTIONS [ { sectionCode: '194', amount: '1000' } ]

USERNAME MUMC28333E
PASSWORD Abcd@1234
ASSESSMENT YEAR 2026-27
SECTIONS [
  { sectionCode: '94A', amount: '124313' },
  { sectionCode: '94C', amount: '26909' },
  { sectionCode: '94J', amount: '19076' },
  { sectionCode: '94I', amount: '799918' }
]


*/
