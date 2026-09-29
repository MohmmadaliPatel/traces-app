# Traces App — API Documentation (By Feature)

Integration guide for external clients. All examples use **placeholder credentials only** — replace with your real values.

**Base URL:** `https://{your-host}` (e.g. `http://localhost:3000`)

**Interactive REST docs:** `/api-docs` | **OpenAPI:** `docs/openapi.yaml`

---

## Table of Contents

1. [How to Call the API](#how-to-call-the-api)
2. [Downloads (PDF / Excel)](#downloads-pdf--excel)
3. [Authentication](#authentication)
4. [Job Monitoring (all async features)](#job-monitoring-all-async-features)
5. [Conso Files](#conso-files)
6. [Form 16 / Form 16A](#form-16--form-16a)
7. [Justification Report](#justification-report)
8. [Challan Status (TRACES)](#challan-status-traces)
9. [Challan Management (Income Tax Portal)](#challan-management-income-tax-portal)
10. [TLDC (Lower Deduction Certificates)](#tldc-lower-deduction-certificates)
11. [LDC Utilisation](#ldc-utilisation)
12. [Outstanding Demand](#outstanding-demand)
13. [Return Status (TDS Returns)](#return-status-tds-returns)
14. [Extract Form 140 / Acknowledgements](#extract-form-140--acknowledgements)
15. [Extract RRR](#extract-rrr)
16. [Error Reference](#error-reference)

---

## How to Call the API

### RPC endpoints (Blitz)

Most features use **POST** `/api/rpc/{operationName}` with this body:

```http
POST /api/rpc/processExcelUploadConso
Content-Type: application/json
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    /* feature-specific fields go here */
  },
  "meta": {}
}
```

**Success response:**

```json
{
  "result": {
    /* operation return value */
  }
}
```

### REST endpoints

Direct JSON POST/GET with the same `Authorization` header (no `params` wrapper):

```http
POST /api/challan/create
Content-Type: application/json
Authorization: Bearer tt_example_token_abc123def4567890

{ "companyId": 1, "assessmentYear": "2025-26", "sections": [...] }
```

### Shared company object (TRACES batch jobs)

Used by Conso, Form 16, Justification, and Challan Status uploads:

```json
{
  "name": "Example Deductor Pvt Ltd",
  "tan": "MUMB12345E",
  "it_password": "income-tax-portal-password",
  "user_id": "traces_deductor_user_id",
  "password": "traces_portal_password"
}
```

| Field | Description |
|-------|-------------|
| `name` | Company / deductor name |
| `tan` | TAN (10 characters) |
| `it_password` | Income Tax e-filing portal password |
| `user_id` | TRACES login user ID |
| `password` | TRACES portal password |

---

## Downloads (PDF / Excel)

Tabular features share one export endpoint. Portal download jobs keep writing files under `public/pdf/...` and are retrieved via the file API.

### Shared tabular export

```http
POST /api/export/{feature}
Authorization: Bearer tt_example_token_abc123def4567890
Content-Type: application/json

{
  "format": "xlsx",
  "companyId": 1,
  "fy": "2024-25",
  "search": "ABCDE1234F"
}
```

| Path param `{feature}` | Description |
|------------------------|-------------|
| `tldc` | TLDC certificate rows |
| `ldc-utilisation` | Limit / consumed / remaining / % |
| `outstanding-demand` | Outstanding demand by company × FY |
| `return-status` | TDS return status rows |
| `rrr` | Last RRR extract (`public/pdf/return/rrr-extract/`) |
| `form140` | Last Form 140 / 26Q extract (pass `formTypeCd`: `T140` or `F26Q`) |
| `deductee-masters` | Deductee PAN/email masters |

| Body field | Required | Description |
|------------|----------|-------------|
| `format` | yes | `xlsx`, `csv`, or `pdf` |
| `companyId` | no | Filter by company |
| `fy` | no | Financial year filter (where applicable) |
| `search` | no | Text search (cert / PAN / name where applicable) |
| `formTypeCd` | no | For `form140` only: `T140` (default) or `F26Q` |

**Success:** binary file with `Content-Disposition: attachment; filename="..."`.

**Empty data:** `404` `{ "success": false, "error": "No data to export for the selected filters" }`.

### Portal file downloads

After Conso / Form 16 / Justification / Challan jobs finish, files land under `public/pdf/...`. Fetch them with:

```http
GET /api/file/pdf/traces/Example%20Deductor%20Pvt%20Ltd/some-file.zip
Authorization: Bearer tt_example_token_abc123def4567890
```

| Feature | Typical folder |
|---------|----------------|
| Conso / Justification | `public/pdf/traces/{Company}/` |
| Conso Excel | `public/pdf/traces_excel/{Company}/` |
| Form 16 / 16A | `public/pdf/form16-download/`, `public/pdf/form16a-download/` |
| Challans | `public/pdf/challans/{Company}/...` |
| TLDC certificate PDFs | `public/pdf/tldc-downloads/` |
| RRR extract | `public/pdf/return/rrr-extract/` |
| Form 140 / 26Q | `public/pdf/Acknowledgement/form140/` (or `form26q/`) |

---

## Authentication

### Log in (get session cookie)

```http
POST /api/rpc/login
Content-Type: application/json

{
  "params": {
    "email": "user@example.com",
    "password": "your-account-password"
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "Example User",
      "role": "USER"
    },
    "publicData": {
      "userId": 1,
      "role": "USER"
    }
  }
}
```

Also returns `Set-Cookie` headers (`not-track_*`) for browser clients.

---

### Create API token (recommended for integrations)

Requires session cookie from login.

```http
POST /api/rpc/createApiToken
Content-Type: application/json
Cookie: not-track_sSessionToken=...
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "name": "My ERP Integration",
    "expiresInDays": 365
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "id": 3,
    "name": "My ERP Integration",
    "prefix": "tt_a1b2c3d4e",
    "token": "tt_a1b2c3d4e5f6789012345678901234567890",
    "expiresAt": "2027-06-23T00:00:00.000Z",
    "createdAt": "2026-06-23T12:00:00.000Z"
  }
}
```

> **Important:** Save `token` immediately — it is shown only once. Use it as `Authorization: Bearer {token}` on all subsequent calls.

---

### List / revoke tokens

```http
POST /api/rpc/getApiTokens
Authorization: Bearer tt_example_token_abc123def4567890

{ "params": {}, "meta": {} }
```

```json
{
  "result": {
    "tokens": [
      {
        "id": 3,
        "name": "My ERP Integration",
        "prefix": "tt_a1b2c3d4e",
        "expiresAt": "2027-06-23T00:00:00.000Z",
        "lastUsedAt": "2026-06-23T14:30:00.000Z",
        "createdAt": "2026-06-23T12:00:00.000Z"
      }
    ]
  }
}
```

```http
POST /api/rpc/revokeApiToken
Authorization: Bearer tt_example_token_abc123def4567890

{ "params": { "id": 3 }, "meta": {} }
```

```json
{ "result": { "success": true } }
```

---

## Job Monitoring (all async features)

Conso, Form 16, Justification, and Challan Status jobs run in the background. After starting a job you receive a `batchId`. Poll until tasks finish.

### Check batch progress

```http
POST /api/rpc/getTaskBatch
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "skip": 0,
    "take": 10,
    "taskFilters": {
      "status": ["Queued", "Running", "Finished", "Failed"]
    }
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "tasksBatch": [
      {
        "id": 42,
        "createdAt": "2026-06-23T12:00:00.000Z",
        "jobTypes": "[\"SendRequest\"]",
        "module": "IT",
        "filters": "{\"financialYear\":\"2024-25\",\"quarter\":\"Q1\",\"actionType\":\"send_request\"}",
        "_count": { "Task": 2 },
        "Task": [
          {
            "id": 101,
            "status": "Finished",
            "companyId": 5,
            "message": null,
            "company": {
              "id": 5,
              "name": "Example Deductor Pvt Ltd",
              "tan": "MUMB12345E"
            }
          },
          {
            "id": 102,
            "status": "Running",
            "companyId": 6,
            "company": {
              "id": 6,
              "name": "Another Company Ltd",
              "tan": "DELA67890B"
            }
          }
        ]
      }
    ],
    "count": 1
  }
}
```

### Get task IDs for a batch

```http
POST /api/rpc/getTaskBatchTaskIds
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "batchId": 42,
    "statusFilter": ["Failed"],
    "companyNameFilter": ["Example Deductor Pvt Ltd"]
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "taskIds": [102],
    "companyIds": [6]
  }
}
```

### View upload history

```http
POST /api/rpc/getUploadHistory
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "skip": 0,
    "take": 50,
    "type": "conso"
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "uploadHistory": [
      {
        "id": 15,
        "companyName": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "status": "Success",
        "financialYear": "2024-25",
        "quarter": "Q1",
        "type": "conso",
        "batchId": 42,
        "filePath": null,
        "createdAt": "2026-06-23T12:00:00.000Z"
      }
    ],
    "count": 1,
    "hasMore": false
  }
}
```

---

## Conso Files

Consolidated TDS statement files from TRACES — **send request** (request generation) or **download file** (download ready files).

### Downloads

- Portal files: `public/pdf/traces/{Company}/` and Excel under `public/pdf/traces_excel/{Company}/`
- Retrieve via `GET /api/file/pdf/traces/...` (see [Downloads (PDF / Excel)](#downloads-pdf--excel))

### Send Request

Queues TRACES jobs to send conso file generation requests for selected FY / quarter / form type combinations.

```http
POST /api/rpc/processExcelUploadConso
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "2024-25",
    "quarter": "Q1",
    "formType": "24Q",
    "actionType": "send_request",
    "jobTypes": ["SendRequest"],
    "sendToAllPeriods": false
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "message": "Companies added to queue successfully",
    "batchId": 42
  }
}
```

**Notes:**
- Set `"sendToAllPeriods": true` to queue all FY × quarter × form type combinations (24Q, 26Q, 27Q, 27EQ).
- `financialYear`, `quarter`, and `formType` can also be arrays for multiple combinations.
- Poll `getTaskBatch` using `batchId` until all tasks are `Finished` or `Failed`.

---

### Download File

Downloads conso files already available on TRACES (no period filters needed).

```http
POST /api/rpc/processExcelUploadConso
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "",
    "quarter": "",
    "actionType": "download_file",
    "jobTypes": ["DownloadFile"]
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "message": "Companies added to queue successfully",
    "batchId": 43
  }
}
```

Downloaded files are saved under the server `public/` directory by the background worker.

---

## Form 16 / Form 16A

Certificate download and processing from TRACES.

### Downloads

- Portal ZIPs/PDFs: `public/pdf/form16-download/`, `public/pdf/form16a-download/`, company folders under `public/pdf/traces/{Company}/`
- Retrieve via `GET /api/file/pdf/...` (see [Downloads (PDF / Excel)](#downloads-pdf--excel))

### Send Request

```http
POST /api/rpc/processExcelUploadForm16
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "2024-25",
    "quarter": "Q4",
    "formType": "24Q",
    "actionType": "send_request",
    "jobTypes": ["SendRequest"],
    "form16Type": "form16",
    "sendToAllPeriods": false,
    "certificateName": ""
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "message": "Companies added to queue successfully",
    "batchId": 44
  }
}
```

| Param | Values |
|-------|--------|
| `form16Type` | `"form16"` or `"form16a"` |
| `actionType` | `"send_request"`, `"download_file"`, or `"sign_pdf"` |

---

### Download File

```http
POST /api/rpc/processExcelUploadForm16
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "",
    "quarter": "",
    "actionType": "download_file",
    "jobTypes": ["DownloadFile"],
    "form16Type": "form16a",
    "certificateName": ""
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "message": "Companies added to queue successfully",
    "batchId": 45
  }
}
```

---

### Sign PDF (Form 16A only)

Digitally signs downloaded Form 16A PDFs using the local `pdf-signer` tool (Windows).

```http
POST /api/rpc/processExcelUploadForm16
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "",
    "quarter": "",
    "actionType": "sign_pdf",
    "jobTypes": ["SignPdf"],
    "form16Type": "form16a",
    "certificateName": "My Digital Certificate Name"
  },
  "meta": {}
}
```

**Response example (paths to signed PDFs):**

```json
{
  "result": [
    "/path/to/public/pdf/form16a/Example Deductor Pvt Ltd/26Q_FY2024-25_Q4/ABCDE1234F_signed.pdf"
  ]
}
```

---

### Generate PDFs from ZIP folders

Converts locally stored ZIP files to PDF without TRACES login.

```http
POST /api/rpc/generateForm16PdfsFromZips
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "sourceFolder": "C:/data/form16-zips/Example Deductor Pvt Ltd",
    "companyName": "Example Deductor Pvt Ltd",
    "tan": "MUMB12345E",
    "financialYear": "2024-25",
    "quarter": "Q4",
    "formType": "24Q",
    "form16Type": "form16a",
    "skipExisting": true
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "success": true,
    "processedZips": 12,
    "generatedPdfs": 10,
    "skippedPdfs": 2,
    "generatedExcel": "C:/data/output/challan_summary.xlsx",
    "outputDir": "C:/data/output/Example Deductor Pvt Ltd",
    "errors": [],
    "message": "Processed 12 ZIP files",
    "logs": [
      "Found 12 ZIP files",
      "Generated PDF for ABCDE1234F",
      "Skipped existing PDF for FGHIJ5678K"
    ]
  }
}
```

---

## Justification Report

Justification report send request and download from TRACES. Same pattern as Conso Files.

### Downloads

- Portal files: `public/pdf/traces/{Company}/`
- Retrieve via `GET /api/file/pdf/traces/...` (see [Downloads (PDF / Excel)](#downloads-pdf--excel))

### Send Request

```http
POST /api/rpc/processExcelUploadJustification
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "2024-25",
    "quarter": "Q2",
    "formType": "26Q",
    "actionType": "send_request",
    "jobTypes": ["SendRequest"],
    "sendToAllPeriods": false
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "message": "Companies added to queue successfully",
    "batchId": 46
  }
}
```

---

### Download File

```http
POST /api/rpc/processExcelUploadJustification
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "",
    "quarter": "",
    "actionType": "download_file",
    "jobTypes": ["DownloadFile"]
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "message": "Companies added to queue successfully",
    "batchId": 47
  }
}
```

---

## Challan Status (TRACES)

Downloads challan status / payment PDF information from TRACES for companies listed in the upload.

### Downloads

- Unconsumed Excel: `public/pdf/unconsumed_challan_results/`
- Related payment PDFs via challan APIs under `public/pdf/challans/...`
- Retrieve via `GET /api/file/pdf/...` (see [Downloads (PDF / Excel)](#downloads-pdf--excel))

### Download Challan Status

```http
POST /api/rpc/processExcelUploadChallanStatus
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companies": [
      {
        "name": "Example Deductor Pvt Ltd",
        "tan": "MUMB12345E",
        "it_password": "income-tax-portal-password",
        "user_id": "traces_deductor_user_id",
        "password": "traces_portal_password"
      }
    ],
    "financialYear": "",
    "quarter": "",
    "actionType": "download_file",
    "jobTypes": ["DownloadChallanStatus"],
    "challanStatusType": "challan_status",
    "onlyPaymentPdfNotInExcel": false
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "message": "Companies added to queue successfully",
    "batchId": 48
  }
}
```

| Param | Description |
|-------|-------------|
| `onlyPaymentPdfNotInExcel` | When `true`, only fetches payment PDFs not already present in challan status Excel |
| `challanStatusType` | Always `"challan_status"` |

---

## Challan Management (Income Tax Portal)

Create and download challans via the Income Tax e-filing portal. These are **REST** endpoints (no `params` wrapper).

### Downloads

- Receipt / payment PDFs: `public/pdf/challans/{Company}/...` (PaymentHistory, GeneratedChallans, CSI)
- Excel rebuilds: `public/pdf/challans-excel-export/`
- Retrieve via `GET /api/file/pdf/challans/...` (see [Downloads (PDF / Excel)](#downloads-pdf--excel))
- Also: `POST /api/challan/download-csi`, `download-payment`, `download-generated-challans`, `download-missing-payment-pdfs`, `download-pdfs-from-unconsumed-excel`, `download-pdfs-from-uploaded-excels`

### Create Challans

```http
POST /api/challan/create
Authorization: Bearer tt_example_token_abc123def4567890
Content-Type: application/json

{
  "companyId": 1,
  "assessmentYear": "2025-26",
  "skipDownload": true,
  "sections": [
    {
      "sectionCode": "192",
      "amount": "50000",
      "actType": "new"
    },
    {
      "sectionCode": "194C",
      "amount": "25000"
    }
  ]
}
```

**Response example:**

```json
{
  "success": true,
  "results": [
    {
      "success": true,
      "sectionCode": "192",
      "sectionDesc": "Salaries",
      "amount": "50000",
      "pymntRefNum": "012345678901234567890"
    },
    {
      "success": true,
      "sectionCode": "194C",
      "sectionDesc": "Payments to contractors",
      "amount": "25000",
      "pymntRefNum": "012345678901234567891"
    }
  ]
}
```

---

### Download Generated Challans

```http
POST /api/challan/download
Authorization: Bearer tt_example_token_abc123def4567890

{ "companyId": 1 }
```

**Response example:**

```json
{
  "success": true,
  "result": {
    "downloaded": 2,
    "files": [
      "public/pdf/challans/Example Deductor Pvt Ltd/192_012345678901234567890.pdf"
    ]
  }
}
```

---

### Fetch Payment History (portal)

```http
POST /api/challan/fetch-payment-history
Authorization: Bearer tt_example_token_abc123def4567890

{ "companyId": 1 }
```

**Response example:**

```json
{
  "success": true,
  "companyName": "Example Deductor Pvt Ltd",
  "tan": "MUMB12345E",
  "payments": [
    {
      "cin": "012345678901234567890",
      "amount": "50000",
      "paymentDate": "15/04/2025",
      "pdfExists": true
    }
  ],
  "gaps": {
    "missing": [],
    "present": [],
    "all": []
  },
  "contentJsonPath": "public/cache/payment-history/MUMB12345E_content.json",
  "gapsJsonPath": "public/cache/payment-history/MUMB12345E_gaps.json"
}
```

---

### Download Payment History PDFs

```http
POST /api/challan/download-payment
Authorization: Bearer tt_example_token_abc123def4567890

{
  "companyId": 1,
  "fromDate": "01/04/2024",
  "toDate": "31/03/2025",
  "assessmentYear": "2025-26",
  "paymentType": "TDS",
  "incomeTaxAct": "new"
}
```

**Response example:**

```json
{
  "success": true,
  "result": {
    "downloaded": 5,
    "skipped": 1
  }
}
```

---

### Download Generated Challans (with filters)

Same body as download-payment:

```http
POST /api/challan/download-generated-challans
Authorization: Bearer tt_example_token_abc123def4567890

{
  "companyId": 1,
  "assessmentYear": "2025-26"
}
```

---

### Download Missing Payment PDFs

```http
POST /api/challan/download-missing-payment-pdfs
Authorization: Bearer tt_example_token_abc123def4567890

{
  "companyId": 1,
  "incomeTaxAct": "new"
}
```

**Response example:**

```json
{
  "success": true,
  "companyName": "Example Deductor Pvt Ltd",
  "result": { "downloaded": 3 },
  "gapsRefreshed": true,
  "challanStatusCoverage": {
    "totalCins": 10,
    "inExcel": 8,
    "notInExcel": 2
  }
}
```

---

## TLDC (Lower Deduction Certificates)

### Downloads

- Tabular export: `POST /api/export/tldc` with `{ "format": "xlsx" | "csv" | "pdf", "companyId?", "fy?", "search?" }`
- Certificate PDFs from portal: `public/pdf/tldc-downloads/` via `GET /api/file/pdf/tldc-downloads/...`

### Fetch from TRACES portal (Old Act)

```http
POST /api/tldc/fetch-data
Authorization: Bearer tt_example_token_abc123def4567890

{
  "tan": "MUMB12345E",
  "year": "2024-25",
  "companyId": 1,
  "credentials": {
    "userId": "traces_deductor_user_id",
    "password": "traces_portal_password",
    "tan": "MUMB12345E"
  }
}
```

**Response example:**

```json
{
  "success": true,
  "data": [
    {
      "certNumber": "CERT001",
      "pan": "ABCDE1234F",
      "panName": "Example Vendor Pvt Ltd",
      "section": "194C",
      "fy": "2024-25"
    }
  ],
  "cached": false,
  "message": "Fetched 5 TLDC records"
}
```

---

### Fetch from TRACES portal (New Act)

```http
POST /api/tldc/fetch-data-new-act
Authorization: Bearer tt_example_token_abc123def4567890

{
  "tan": "MUMB12345E",
  "year": "2026-27",
  "companyId": 1,
  "initiateIfNoRequest": true,
  "forceInitiate": false,
  "credentials": {
    "userId": "traces_deductor_user_id",
    "password": "traces_portal_password",
    "tan": "MUMB12345E"
  }
}
```

### Refresh existing records (New Act)

```http
POST /api/tldc/update-data-new-act
Authorization: Bearer tt_example_token_abc123def4567890

{
  "tan": "MUMB12345E",
  "year": "2026-27",
  "companyId": 1,
  "credentials": {
    "userId": "traces_deductor_user_id",
    "password": "traces_portal_password",
    "tan": "MUMB12345E"
  }
}
```

### Refresh existing records (Old Act)

```http
POST /api/tldc/update-data
Authorization: Bearer tt_example_token_abc123def4567890

{
  "tan": "MUMB12345E",
  "year": "2024-25",
  "companyId": 1,
  "recordId": 10,
  "credentials": {
    "userId": "traces_deductor_user_id",
    "password": "traces_portal_password",
    "tan": "MUMB12345E"
  }
}
```

---

### List / manage TLDC in database (RPC)

```http
POST /api/rpc/getTldcData
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "skip": 0,
    "take": 50,
    "search": "ABCDE1234F"
  },
  "meta": {}
}
```

```http
POST /api/rpc/upsertTldcData
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "companyId": 1,
    "certNumber": "CERT001",
    "din": "DIN123456",
    "fy": "2024-25",
    "pan": "ABCDE1234F",
    "panName": "Example Vendor Pvt Ltd",
    "section": "194C",
    "NatureOfPayment": "Contract",
    "tdsAmountLimit": "100000",
    "tdsAmountConsumed": "25000",
    "tdsRate": "1",
    "validFrom": "2024-04-01T00:00:00.000Z",
    "validTo": "2025-03-31T00:00:00.000Z",
    "isActive": true
  },
  "meta": {}
}
```

---

## LDC Utilisation

Certificate utilisation (limit vs consumed) derived from stored TLDC rows. Refresh numbers by running TLDC fetch/update first.

### Downloads

- `POST /api/export/ldc-utilisation` with `{ "format": "xlsx" | "csv" | "pdf", "companyId?", "fy?", "search?" }`

### List utilisation (RPC)

```http
POST /api/rpc/getLdcUtilisation
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "where": { "companyId": 1, "fy": "2024-25" },
    "skip": 0,
    "take": 50,
    "search": "ABCDE1234F"
  },
  "meta": {}
}
```

**Response fields per row:** `amountLimit`, `amountConsumed`, `amountRemaining`, `utilisationPct`, plus certificate identity (`certNumber`, `pan`, `section`, `fy`, company, …).

---

## Outstanding Demand

### Downloads

- `POST /api/export/outstanding-demand` with `{ "format": "xlsx" | "csv" | "pdf", "companyId?", "fy?" }`

### Fetch from Income Tax portal

```http
POST /api/outstanding-demand/fetch
Authorization: Bearer tt_example_token_abc123def4567890

{
  "companyId": 1,
  "credentials": {
    "userId": "traces_deductor_user_id",
    "password": "traces_portal_password",
    "tan": "MUMB12345E"
  }
}
```

**Response example:**

```json
{
  "success": true,
  "data": [
    {
      "finYr": "2023-24",
      "fin": "2023-24",
      "aodmnd": "15000.00",
      "cpcdmd": "5000.00"
    }
  ],
  "saved": 1,
  "updated": 2,
  "errors": 0,
  "message": "Successfully fetched and saved outstanding demand data. Saved: 1, Updated: 2"
}
```

---

### List from database

```http
POST /api/rpc/getOutstandingDemand
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "where": { "companyId": 1 },
    "skip": 0,
    "take": 50
  },
  "meta": {}
}
```

**Response example:**

```json
{
  "result": {
    "outstandingDemand": [
      {
        "id": 1,
        "companyId": 1,
        "finYr": "2023-24",
        "fin": "2023-24",
        "aodmnd": "15000.00",
        "cpcdmd": "5000.00"
      }
    ],
    "count": 1
  }
}
```

---

## Return Status (TDS Returns)

### Downloads

- `POST /api/export/return-status` with `{ "format": "xlsx" | "csv" | "pdf", "companyId?", "fy?" }`

### Fetch from portal

```http
POST /api/return-status/fetch
Authorization: Bearer tt_example_token_abc123def4567890

{
  "companyId": 1,
  "credentials": {
    "userId": "traces_deductor_user_id",
    "password": "traces_portal_password",
    "tan": "MUMB12345E"
  },
  "financialYears": ["2024-25"],
  "quarters": ["Q1", "Q2"],
  "formTypes": ["24Q", "26Q"]
}
```

**Response example:**

```json
{
  "success": true,
  "data": [
    {
      "finyear": "2024-25",
      "quarter": "Q1",
      "formtype": "24Q",
      "tokenno": "123456789",
      "status": "Processed",
      "dtoffiling": "15/07/2024"
    }
  ],
  "saved": 2,
  "updated": 0,
  "errors": [],
  "message": "Return status fetched successfully"
}
```

---

### List from database

```http
POST /api/rpc/getReturnStatus
Authorization: Bearer tt_example_token_abc123def4567890

{
  "params": {
    "where": { "companyId": 1 },
    "skip": 0,
    "take": 50
  },
  "meta": {}
}
```

---

## Extract Form 140 / Acknowledgements

Pull acknowledgement / Form 140 (or Form 26Q) receipts from the Income Tax portal for selected companies.

### Downloads

- Tabular export: `POST /api/export/form140` with `{ "format": "xlsx" | "csv" | "pdf", "formTypeCd": "T140" | "F26Q" }`
- Server also writes Excel/JSON under `public/pdf/Acknowledgement/form140/` (or `form26q/`)
- Receipt PDFs under the same tree; retrieve via `GET /api/file/pdf/Acknowledgement/...`

### Extract

```http
POST /api/form140/extract
Authorization: Bearer tt_example_token_abc123def4567890

{
  "companyIds": [1, 2],
  "formTypeCd": "T140",
  "financialYears": ["2024-25"],
  "quarters": ["Q1", "Q2"],
  "concurrency": 2
}
```

---

## Extract RRR

Extract RRR / acknowledgement numbers from the Income Tax portal for selected companies, FYs, quarters, and form types.

### Downloads

- Tabular export: `POST /api/export/rrr` with `{ "format": "xlsx" | "csv" | "pdf" }`
- Aggregate files: `public/pdf/return/rrr-extract/rrr_extract.csv` and `.json`
- Retrieve via `GET /api/file/pdf/return/rrr-extract/...`

### Extract

```http
POST /api/rrr/extract
Authorization: Bearer tt_example_token_abc123def4567890

{
  "companyIds": [1, 2],
  "financialYears": ["2024-25"],
  "quarters": ["Q1"],
  "formTypes": ["24Q", "26Q"],
  "concurrency": 2
}
```

---

## Error Reference

| Status | When | Example body |
|--------|------|----------------|
| `401` | Missing or invalid Bearer / session | `{ "error": "Unauthorized" }` |
| `403` | WAF blocked unsafe input | `{ "message": "Invalid request body detected" }` |
| `405` | Wrong HTTP method | `{ "error": "Method not allowed" }` |
| `500` | Server / portal automation error | `{ "error": "Failed to create challan" }` |

**RPC auth error:**

```json
{
  "error": "You must be logged in to access this",
  "name": "AuthenticationError"
}
```

---

## Quick Reference — Endpoint by Feature

| Feature | Operation | Method | Path |
|---------|-----------|--------|------|
| Export | Excel / CSV / PDF | POST | `/api/export/{feature}` |
| Files | Portal download | GET | `/api/file/{slug}` |
| Conso | Send request | POST | `/api/rpc/processExcelUploadConso` |
| Conso | Download file | POST | `/api/rpc/processExcelUploadConso` |
| Form 16 | Send request | POST | `/api/rpc/processExcelUploadForm16` |
| Form 16 | Download file | POST | `/api/rpc/processExcelUploadForm16` |
| Form 16 | Sign PDF | POST | `/api/rpc/processExcelUploadForm16` |
| Form 16 | ZIP → PDF | POST | `/api/rpc/generateForm16PdfsFromZips` |
| Justification | Send request | POST | `/api/rpc/processExcelUploadJustification` |
| Justification | Download file | POST | `/api/rpc/processExcelUploadJustification` |
| Challan status | Download | POST | `/api/rpc/processExcelUploadChallanStatus` |
| Challan | Create | POST | `/api/challan/create` |
| Challan | Download | POST | `/api/challan/download` |
| Challan | Payment history | POST | `/api/challan/fetch-payment-history` |
| Challan | Payment PDFs | POST | `/api/challan/download-payment` |
| Challan | CSI download | POST | `/api/challan/download-csi` |
| Payment gaps | Read cache | GET | `/api/challan/payment-history-gaps` |
| TLDC | Fetch (Old Act) | POST | `/api/tldc/fetch-data` |
| TLDC | Fetch (New Act) | POST | `/api/tldc/fetch-data-new-act` |
| TLDC | Update (New Act) | POST | `/api/tldc/update-data-new-act` |
| LDC utilisation | List | POST | `/api/rpc/getLdcUtilisation` |
| Form 140 | Extract | POST | `/api/form140/extract` |
| RRR | Extract | POST | `/api/rrr/extract` |
| Jobs | Monitor batch | POST | `/api/rpc/getTaskBatch` |
| Auth | Create token | POST | `/api/rpc/createApiToken` |

For the complete machine-readable REST spec, see `docs/openapi.yaml`.
