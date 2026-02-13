import { ErrorFallbackProps, ErrorComponent, ErrorBoundary, AppProps } from "@blitzjs/next"
import { AuthenticationError, AuthorizationError } from "blitz"
import { useRouter } from "next/router"
import React, { Suspense } from "react"
import { withBlitz } from "src/blitz-client"
import "src/styles/globals.css"
import { NotificationProvider } from "src/utils/NotificationContext"

function RootErrorFallback({ error }: ErrorFallbackProps) {
  const router = useRouter()
  if (error instanceof AuthenticationError) {
    void router.push("/auth/login")
    return <div>Error: You are not authenticated, You will be redirected to login shortly</div>
  } else if (error instanceof AuthorizationError) {
    return (
      <ErrorComponent
        statusCode={error.statusCode}
        title="Sorry, you are not authorized to access this"
      />
    )
  } else {
    return (
      <ErrorComponent
        statusCode={(error as any)?.statusCode || 400}
        title={error.message || error.name}
      />
    )
  }
}

function MyApp({ Component, pageProps }: AppProps) {
  const getLayout = Component.getLayout || ((page) => page)

  return (
    <ErrorBoundary FallbackComponent={RootErrorFallback}>
      <NotificationProvider>
        <Suspense fallback="Loading...">{getLayout(<Component {...pageProps} />)}</Suspense>
      </NotificationProvider>
    </ErrorBoundary>
  )
}

export default withBlitz(MyApp)
