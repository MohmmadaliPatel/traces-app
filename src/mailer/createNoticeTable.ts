export type NoticeData = {
  Assessee: string
  "Proceeding Name": string
  "Notice Section": string | null
  "Assessment Year": string
  "Notice date": any
  "Response date": any
}[]

export type GstNoticeData = {
  Assessee: string
  tradeName: string
  OrderId: string
  NoticeType: string
  AmountOFDemand: number | null
  dateOfNotice: any
}[]

export type GstAdditionalNoticeData = {
  tradeName: string
  type: string
  refNo: string
  issueDate: string
  dueDate: string
  section: string
}[]

export default function createNoticeTable(data: NoticeData) {
  console.log(`📋 Creating notice table with ${data?.length || 0} records`)

  // Validate input data
  if (!data || !Array.isArray(data)) {
    console.error("❌ Invalid data provided to createNoticeTable:", data)
    throw new Error("Invalid data provided to createNoticeTable")
  }

  if (data.length === 0) {
    console.error("❌ Empty data array provided to createNoticeTable")
    throw new Error("No notice data provided for email template")
  }

  // Generate HTML table rows by looping over notices
  let tableRows = data
    .map((notice, index) => {
      console.log(`  Processing notice ${index + 1}:`, {
        Assessee: notice.Assessee,
        ProceedingName: notice["Proceeding Name"],
        NoticeSection: notice["Notice Section"],
        AssessmentYear: notice["Assessment Year"],
      })

      return `
          <tr>
              <td>${notice.Assessee || "N/A"}</td>
              <td>${notice["Proceeding Name"] || "N/A"}</td>
              <td>${notice["Notice Section"] || "N/A"}</td>
              <td>${notice["Assessment Year"] || "N/A"}</td>
              <td>${notice["Notice date"] || "N/A"}</td>
              <td>${notice["Response date"] || "N/A"}</td>
          </tr>
      `
    })
    .join("")

  console.log(`✅ Successfully generated ${data.length} table rows for email template`)

  // Define the complete HTML content using a template literal
  let htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Notice Issued by Income-Tax Department</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  margin: 0;
                  padding: 0;
                  background-color: #f4f4f4;
              }
              .email-container {
                  width: 100%;
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  padding: 20px;
                  border-radius: 5px;
                  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
              }
              h2 {
                  text-align: center;
                  color: #333333;
              }
              table {
                  width: 100%;
                  border-collapse: collapse;
                  margin: 20px 0;
              }
              table, th, td {
                  border: 1px solid #dddddd;
              }
              th, td {
                  padding: 12px;
                  text-align: left;
              }
              th {
                  background-color: #f2f2f2;
              }
              hr {
                  border: 0;
                  border-top: 1px solid #cccccc;
                  margin: 20px 0;
              }
          </style>
      </head>
      <body>

      <div class="email-container">
          <h2>Notice Issued by Income-Tax Department</h2>
          <p>The income-tax department has issued new notices. The details are as follows:</p>
          <table>
              <thead>
                  <tr>
                      <th>Assessee</th>
                      <th>Proceeding Name</th>
                      <th>Notice Section</th>
                      <th>Assessment Year</th>
                      <th>Notice Date</th>
                      <th>Response Date</th>
                  </tr>
              </thead>
              <tbody>
                  ${tableRows}
              </tbody>
          </table>
          <p>Please ensure that the necessary actions are taken before the response dates.</p>
      </div>

      </body>
      </html>
      `
  return htmlContent
}

export function createGstNoticeTable(data: any) {
  // Generate HTML table rows by looping over notices
  let tableRows = data
    .map(
      (notice) => `
          <tr>
              <td>${notice.Assessee}</td>
              <td>${notice.tradeName}</td>
              <td>${notice.OrderId}</td>
              <td>${notice.NoticeType}</td>
              <td>${notice.AmountOFDemand}</td>
              <td>${notice.dateOfNotice}</td>
          </tr>
      `
    )
    .join("")

  // Define the complete HTML content using a template literal
  let htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Notice Issued by GST Department</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  margin: 0;
                  padding: 0;
                  background-color: #f4f4f4;
              }
              .email-container {
                  width: 100%;
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  padding: 20px;
                  border-radius: 5px;
                  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
              }
              h2 {
                  text-align: center;
                  color: #333333;
              }
              table {
                  width: 100%;
                  border-collapse: collapse;
                  margin: 20px 0;
              }
              table, th, td {
                  border: 1px solid #dddddd;
              }
              th, td {
                  padding: 12px;
                  text-align: left;
              }
              th {
                  background-color: #f2f2f2;
              }
              hr {
                  border: 0;
                  border-top: 1px solid #cccccc;
                  margin: 20px 0;
              }
          </style>
      </head>
      <body>

      <div class="email-container">
          <h2>Notice Issued by GST Department</h2>
          <p>The GST department has issued new notices. The details are as follows:</p>
          <table>
              <thead>
                  <tr>
                      <th>Assessee</th>
                      <th>Trade Name</th>
                      <th>Order ID</th>
                      <th>Notice Type</th>
                      <th>Amount of Demand</th>
                      <th>Date of Notice</th>
                  </tr>
              </thead>
              <tbody>
                  ${tableRows}
              </tbody>
          </table>
          <p>Please ensure that the necessary actions are taken promptly.</p>
      </div>

      </body>
      </html>
      `
  return htmlContent
}

export function createGstAdditionalNoticeTable(data: GstAdditionalNoticeData) {
  // Generate HTML table rows by looping over notices
  let tableRows = data
    .map(
      (notice) => `
          <tr>
              <td>${notice.tradeName}</td>
              <td>${notice.type}</td>
              <td>${notice.refNo}</td>
              <td>${notice.issueDate}</td>
              <td>${notice.dueDate}</td>
              <td>${notice.section}</td>
          </tr>
      `
    )
    .join("")

  // Define the complete HTML content using a template literal
  let htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Notice Issued by GST Department</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  margin: 0;
                  padding: 0;
                  background-color: #f4f4f4;
              }
              .email-container {
                  width: 100%;
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  padding: 20px;
                  border-radius: 5px;
                  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
              }
              h2 {
                  text-align: center;
                  color: #333333;
              }
              table {
                  width: 100%;
                  border-collapse: collapse;
                  margin: 20px 0;
              }
              table, th, td {
                  border: 1px solid #dddddd;
              }
              th, td {
                  padding: 12px;
                  text-align: left;
              }
              th {
                  background-color: #f2f2f2;
              }
              hr {
                  border: 0;
                  border-top: 1px solid #cccccc;
                  margin: 20px 0;
              }
          </style>
      </head>
      <body>

      <div class="email-container">
          <h2>Notice Issued by GST Department</h2>
          <p>The GST department has issued new notices. The details are as follows:</p>
          <table>
              <thead>
                  <tr>
                      <th>Company Name</th>
                      <th>Type</th>
                      <th>Reference Number</th>
                      <th>Issue Date</th>
                      <th>Due Date</th>
                      <th>Section</th>
                  </tr>
              </thead>
              <tbody>
                  ${tableRows}
              </tbody>
          </table>
          <p>Please ensure that the necessary actions are taken promptly.</p>
      </div>

      </body>
      </html>
      `
  return htmlContent
}
