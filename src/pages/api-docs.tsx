import dynamic from "next/dynamic"
import React from "react"
import { BlitzPage } from "@blitzjs/next"

import "swagger-ui-react/swagger-ui.css"

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false }) as React.ComponentType<{
  url: string
  docExpansion?: string
  defaultModelsExpandDepth?: number
}>

const ApiDocsPage: BlitzPage = () => {
  return (
    <div style={{ padding: "1rem" }}>
      <h1 style={{ marginBottom: "1rem" }}>REST API Documentation</h1>
      <p style={{ marginBottom: "1rem" }}>
        Interactive documentation for REST endpoints. Full RPC reference including Blitz mutations
        and queries is in <code>docs/API.md</code>.
      </p>
      <SwaggerUI url="/docs/openapi.yaml" docExpansion="list" defaultModelsExpandDepth={1} />
    </div>
  )
}

ApiDocsPage.authenticate = { redirectTo: "/auth/login" }

export default ApiDocsPage
