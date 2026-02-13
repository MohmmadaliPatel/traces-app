/**
 * Test Form 16 PDF Generation Page
 * Access at: http://localhost:3000/test-form16
 */

import React, { useState } from "react"
import { BlitzPage } from "@blitzjs/next"
import Layout from "src/core/layouts/Layout"

const TestForm16Page: BlitzPage = () => {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [useExtracted, setUseExtracted] = useState(true) // Default to true for faster testing

  const handleTest = async (skipExtraction: boolean = useExtracted) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const url = skipExtraction
        ? "/api/test-form16?useExtracted=true"
        : "/api/test-form16?password=MUMC18011A"

      const response = await fetch(url)
      const data = await response.json()

      if (data.success) {
        setResult(data)
      } else {
        setError(data.error || "Unknown error")
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px" }}>
      <h1>🧪 Test Form 16 PDF Generation</h1>

      <div
        style={{
          background: "#f5f5f5",
          padding: "20px",
          borderRadius: "8px",
          marginBottom: "20px",
        }}
      >
        <p>
          <strong>ZIP File:</strong> public\pdf\MUMxxxxx1A_FORM16A_2025-26_Q2_184644864.zip
        </p>
        <p>
          <strong>Extracted File:</strong>{" "}
          public\pdf\MUMxxxxx1A_FORM16A_2025-26_Q2_184644864\MUMxxxxx1A_FORM16A_2025-26_Q2_184644864.txt
        </p>
        <p>
          <strong>Output:</strong> public\pdf\form16-test-output
        </p>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={useExtracted}
            onChange={(e) => setUseExtracted(e.target.checked)}
            style={{ marginRight: "8px", width: "18px", height: "18px", cursor: "pointer" }}
          />
          <span style={{ fontSize: "14px" }}>
            ⚡ Use already extracted file (faster, skips ZIP extraction)
          </span>
        </label>
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button
          onClick={() => handleTest(useExtracted)}
          disabled={loading}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            backgroundColor: loading ? "#ccc" : "#0070f3",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {loading ? "⏳ Processing..." : "🚀 Generate PDFs"}
        </button>

        {useExtracted && (
          <button
            onClick={() => handleTest(false)}
            disabled={loading}
            style={{
              padding: "12px 24px",
              fontSize: "16px",
              backgroundColor: loading ? "#ccc" : "#6c757d",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            Extract from ZIP
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: "20px",
            padding: "15px",
            background: "#fee",
            border: "1px solid #fcc",
            borderRadius: "4px",
          }}
        >
          <h3 style={{ color: "#c00", margin: "0 0 10px 0" }}>❌ Error</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>{error}</pre>
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: "20px",
            padding: "15px",
            background: "#efe",
            border: "1px solid #cfc",
            borderRadius: "4px",
          }}
        >
          <h3 style={{ color: "#080", margin: "0 0 10px 0" }}>✅ Success!</h3>
          <p>
            <strong>Generated {result.files.length} PDF(s)</strong>
          </p>

          <h4>Employee Details:</h4>
          {result.employeeDetails.map((emp: any, idx: number) => (
            <div
              key={idx}
              style={{
                background: "white",
                padding: "10px",
                marginBottom: "10px",
                borderRadius: "4px",
              }}
            >
              <div>
                <strong>PAN:</strong> {emp.pan}
              </div>
              <div>
                <strong>Name:</strong> {emp.name}
              </div>
              <div>
                <strong>Assessment Year:</strong> {emp.assessmentYear}
              </div>
              <div>
                <strong>Tax Deducted:</strong> ₹{emp.taxDeducted}
              </div>
              <div>
                <strong>Tax Deposited:</strong> ₹{emp.taxDeposited}
              </div>
            </div>
          ))}

          <h4>Generated Files:</h4>
          <ul>
            {result.files.map((file: string, idx: number) => (
              <li key={idx}>
                <a
                  href={`${result.outputFolder}/${file}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#0070f3" }}
                >
                  {file}
                </a>
              </li>
            ))}
          </ul>

          <details style={{ marginTop: "15px" }}>
            <summary style={{ cursor: "pointer", fontWeight: "bold" }}>📋 Show Logs</summary>
            <pre
              style={{
                background: "#f9f9f9",
                padding: "10px",
                borderRadius: "4px",
                fontSize: "12px",
                marginTop: "10px",
                overflow: "auto",
              }}
            >
              {result.logs.join("\n")}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

TestForm16Page.suppressFirstRenderFlicker = true
TestForm16Page.getLayout = (page) => <Layout title="Test Form 16">{page}</Layout>

export default TestForm16Page
