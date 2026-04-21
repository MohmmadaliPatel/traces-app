import { wrapper } from "axios-cookiejar-support"
import { CookieJar } from "tough-cookie"
import axios from "axios"
import { secCodes as oldSecCodes } from "../challan/utils/secCodes"
import { secCodes as newSecCodes } from "../challan/utils/newSecCodes"
import type { IncomeTaxActKind } from "../challan/utils/incomeTaxAct"
import { downloadChallans } from "./downloadChallan"
const axiosRetry = require("axios-retry").default

function delay(time: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time)
  })
}

const jar = new CookieJar()
const axiosClient = wrapper(
  axios.create({
    jar: jar,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-gpc": "1",
      Referer: "https://eportal.incometax.gov.in/iec/foservices/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.82 Safari/537.36",
    },
  } as any) as any
)
axiosRetry(axiosClient, { retries: 3 })



async function loadLoginPage() {
  try {
    await axiosClient.get("https://eportal.incometax.gov.in/iec/foservices/#/login", {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error) {
    console.error(error)
  }
}

async function login(pan: string, password: string) {
  await loadLoginPage()
  const panResponse = await verifyPan(pan)
  await delay(5000)
  const res = await verifyPassword(panResponse.reqId, panResponse.role, pan, password)
  const shouldForceLogin = res.messages.some((m: any) => m.code === "EF00177")
  const InvalidPassword = res.messages.some((m: any) => m.code === "EF00027")
  if (InvalidPassword) {
    throw new Error("Invalid password")
  }
  if (shouldForceLogin) {
    console.log("It seems this user is already logged in someother device")
    await delay(5000)
    await forceLogin(panResponse.reqId, panResponse.role, pan, password)
  }
}

async function forceLogin(reqId: string, role: string, pan: string, password: string) {
  try {
    console.log("Trying to force login")
    const res = await axiosClient.post("https://eportal.incometax.gov.in/iec/loginapi/login", {
      errors: [],
      reqId: reqId,
      entity: pan,
      entityType: "PAN",
      role,
      uidValdtnFlg: "true",
      aadhaarMobileValidated: "false",
      secAccssMsg: "",
      secLoginOptions: "",
      dtoService: "LOGIN",
      exemptedPan: "false",
      userConsent: "",
      imgByte: null,
      pass: password,
      passValdtnFlg: null,
      otpGenerationFlag: null,
      otp: null,
      otpValdtnFlg: null,
      otpSourceFlag: null,
      contactPan: null,
      contactMobile: null,
      contactEmail: null,
      email: null,
      mobileNo: null,
      forgnDirEmailId: null,
      imagePath: null,
      serviceName: "loginService",
      aadhaarLinkedWithUserId: "Y",
      userType: "IND",
      remark: "Continue",
      lastLoginSuccessFlag: "true",
    })
    return res.data
  } catch (error) {
    console.log(`Unable to login forcefully`)
    throw error
  }
}

async function verifyPan(pan: string) {
  try {
    const res = await axiosClient.post("https://eportal.incometax.gov.in/iec/loginapi/login", {
      entity: pan,
      serviceName: "wLoginService",
    })
    return res.data
  } catch (error) {
    throw error
  }
}

async function verifyPassword(reqId: string, role: string, pan: string, password: string) {
  try {
    const res = await axiosClient.post("https://eportal.incometax.gov.in/iec/loginapi/login", {
      errors: [],
      reqId: reqId,
      entity: pan,
      entityType: "PAN",
      role,
      uidValdtnFlg: "true",
      aadhaarMobileValidated: "false",
      secAccssMsg: "",
      secLoginOptions: "",
      dtoService: "LOGIN",
      exemptedPan: "false",
      userConsent: "",
      imgByte: null,
      pass: password,
      passValdtnFlg: null,
      otpGenerationFlag: null,
      otp: null,
      otpValdtnFlg: null,
      otpSourceFlag: null,
      contactPan: null,
      contactMobile: null,
      contactEmail: null,
      email: null,
      mobileNo: null,
      forgnDirEmailId: null,
      imagePath: null,
      serviceName: "loginService",
    })
    console.log(res.data)
    return res.data
  } catch (error) {
    throw error
  }
}

function price_in_words(price: any): string {
  const sglDigit = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"],
    dblDigit = [
      "Ten",
      "Eleven",
      "Twelve",
      "Thirteen",
      "Fourteen",
      "Fifteen",
      "Sixteen",
      "Seventeen",
      "Eighteen",
      "Nineteen",
    ],
    tensPlace = [
      "",
      "Ten",
      "Twenty",
      "Thirty",
      "Forty",
      "Fifty",
      "Sixty",
      "Seventy",
      "Eighty",
      "Ninety",
    ],
    handle_tens = function (dgt: any, prevDgt: any) {
      return 0 == dgt ? "" : " " + (1 == dgt ? dblDigit[prevDgt] : tensPlace[dgt])
    },
    handle_utlc = function (dgt: any, nxtDgt: any, denom: any) {
      return (
        (0 != dgt && 1 != nxtDgt ? " " + sglDigit[dgt] : "") +
        (0 != nxtDgt || dgt > 0 ? " " + denom : "")
      )
    }

  var str = "",
    digitIdx = 0,
    digit = 0,
    nxtDigit = 0,
    words: string[] = []
  if (((price += ""), isNaN(parseInt(price)))) str = ""
  else if (parseInt(price) > 0 && price.length <= 10) {
    for (digitIdx = price.length - 1; digitIdx >= 0; digitIdx--)
      switch (
        ((digit = price[digitIdx] - 0),
        (nxtDigit = digitIdx > 0 ? price[digitIdx - 1] - 0 : 0),
        price.length - digitIdx - 1)
      ) {
        case 0:
          words.push(handle_utlc(digit, nxtDigit, ""))
          break
        case 1:
          words.push(handle_tens(digit, price[digitIdx + 1]))
          break
        case 2:
          words.push(
            0 != digit
              ? ` ${sglDigit[digit]} Hundred${
                  0 != price[digitIdx + 1] && 0 != price[digitIdx + 2] ? " and" : ""
                }`
              : ""
          )
          break
        case 3:
          words.push(handle_utlc(digit, nxtDigit, "Thousand"))
          break
        case 4:
          words.push(handle_tens(digit, price[digitIdx + 1]))
          break
        case 5:
          words.push(handle_utlc(digit, nxtDigit, "Lakh"))
          break
        case 6:
          words.push(handle_tens(digit, price[digitIdx + 1]))
          break
        case 7:
          words.push(handle_utlc(digit, nxtDigit, "Crore"))
          break
        case 8:
          words.push(handle_tens(digit, price[digitIdx + 1]))
          break
        case 9:
          words.push(
            0 != digit
              ? " " +
                  sglDigit[digit] +
                  " Hundred" +
                  (0 != price[digitIdx + 1] || 0 != price[digitIdx + 2] ? " and" : " Crore")
              : ""
          )
      }
    str = words.reverse().join("")
  } else str = ""
  return str
}

export type { IncomeTaxActKind } from "../challan/utils/incomeTaxAct"

interface CreateChallanParams {
  companyName: string
  companyCode: string
  username: string
  password: string
  assessmentYear: string
  sections: Array<{ sectionCode: string; amount: string; actType?: IncomeTaxActKind }>
}

function actKindToPortalCode(actType: IncomeTaxActKind | undefined): "O" | "N" {
  return actType === "new" ? "N" : "O"
}

function secCodesForAct(actType: IncomeTaxActKind | undefined) {
  return actType === "new" ? newSecCodes : oldSecCodes
}

export async function createChallan(params: CreateChallanParams) {
  const { username, password, assessmentYear, sections, companyName, companyCode } = params

  console.log("USERNAME", username)
  console.log("PASSWORD", password)
  console.log("ASSESSMENT YEAR", assessmentYear)
  console.log("SECTIONS", sections)

  // await downloadChallans(
  //   username,
  //   password,
  //   companyName || `${username}_${companyCode}`,
  //   1
  // )

  await login(username.toUpperCase(), Buffer.from(password).toString("base64"))

  const results: Array<{
    sectionCode: string
    sectionDesc: string
    amount: string
    success: boolean
    pymntRefNum?: string
    error?: string
  }> = []

  const res = await axiosClient.post(
    "https://eportal.incometax.gov.in/iec/servicesapi/auth/saveEntity",
    {
      serviceName: "userProfileService",
      userId: username,
    }
  )

  console.log("RES", res.data)

  for (const section of sections) {
    const { sectionCode, amount, actType } = section
    const portalAct = actKindToPortalCode(actType)
    const secTable = secCodesForAct(actType)
    try {
      console.log(`Creating challan for ${sectionCode} ${amount} (Act: ${portalAct})`)
      const secCodeData = secTable.find((s) => s.sec_cd.trim() === sectionCode.trim())
      console.log("SEC CODE DATA", secCodeData)
      if (!secCodeData) {
        results.push({
          sectionCode,
          sectionDesc: "",
          amount,
          success: false,
          error: "Invalid section code",
        })
        continue
      }

      const { natr_pymnt_desc, sec_cd, sec_desc } = secCodeData

      const Tax = amount
      const totalAmt = Tax
      const draftData: any = {
        header: { formName: "PO-03-PYMNT" },
        formData: {
          pan: username.toUpperCase(),
          tileId: "12",
          majorHead: "0021",
          minorHead: 200,
          majorSlNum: "2",
          minorSlNum: "13",
          basicTax: Number(Tax),
          surCharge: 0,
          eduCess: 0,
          interest: 0,
          penalty: 0,
          others: 0,
          totalAmt: Number(totalAmt),
          ...(actType === "new"
            ? { taxYear: assessmentYear }
            : { assmentYear: assessmentYear }),
          actType: portalAct,
          // Portal expects sentence-style words (e.g. "Rupees one thousand Only"), not title case.
          totalAmtWord: `Rupees ${String(price_in_words(totalAmt)).trim().toLowerCase()} Only`,
          subPayMode: "",
          bankCd: "",
          natrPymntDesc: natr_pymnt_desc,
          secCd: sec_cd,
          secDesc: sec_desc,
          pageName: "addTaxBreakupDetails",
          createdByUser: username.toUpperCase(),
        },
        createdByUser: username.toUpperCase(),
      }
      console.log("DRAFT DATA 1", draftData)
      const res = await axiosClient.post(
        "https://eportal.incometax.gov.in/iec/paymentapi/auth/challan/savedraft",
        draftData
      )
      draftData.formData.pymntRefNum = res.data.pymntRefNum
      draftData.formData.paymentMode = "NER"
      console.log("DRAFT DATA 2")
      await axiosClient.post(
        "https://eportal.incometax.gov.in/iec/paymentapi/auth/challan/savedraft",
        draftData
      )
      draftData.formData.bankCode = "RBIS"
      draftData.formData.subMinorHd = ""
      draftData.formData.loginType = "post"
      console.log("DRAFT DATA 3")
      const response = await axiosClient.post(
        "https://eportal.incometax.gov.in/iec/paymentapi/auth/challan/create",
        {
          header: { formName: "PO-03-PYMNT" },
          formData: {
            pan: draftData.formData.pan,
            paymentMode: draftData.formData.paymentMode,
            subPayMode: "",
            majorHead: draftData.formData.majorHead,
            minorHead: draftData.formData.minorHead,
            surCharge: draftData.formData.surCharge,
            totalAmt: draftData.formData.totalAmt,
            ...(actType === "new"
              ? { taxYear: assessmentYear }
              : { assmentYear: assessmentYear }),
            totalAmtWord: draftData.formData.totalAmtWord,
            bankCode: "RBIS",
            basicTax: draftData.formData.basicTax,
            eduCess: draftData.formData.eduCess,
            interest: draftData.formData.interest,
            penalty: draftData.formData.penalty,
            others: draftData.formData.others,
            pymntRefNum: draftData.formData.pymntRefNum,
            tileId: draftData.formData.tileId,
            loginType: "post",
            majorSlNum: draftData.formData.majorSlNum,
            minorSlNum: draftData.formData.minorSlNum,
            subMinorHd: "",
            actType: portalAct,
            createdByUser: draftData.formData.createdByUser,
          },
        }
      )

      console.log(`Challan created for ${sectionCode} ${amount}`)
      console.log("RESPONSE", response.data)
      results.push({
        sectionCode,
        sectionDesc: sec_desc,
        amount,
        success: true,
        pymntRefNum: draftData.formData.pymntRefNum,
      })
    } catch (error: any) {
      console.error(`Error creating challan for ${sectionCode}:`, error)
      results.push({
        sectionCode,
        sectionDesc: "",
        amount,
        success: false,
        error: error.message || "Failed to create challan",
      })
    }
  }

  // Download the created challans
  const successfulCount = results.filter((r) => r.success).length

  if (successfulCount > 0) {
    const anySuccessfulNewAct = sections.some(
      (s, i) => results[i]?.success === true && s.actType === "new"
    )
    console.log(
      `Downloading ${successfulCount} challan(s); Income-tax Act 2025 radio: ${anySuccessfulNewAct ? "yes" : "no (old only)"}`
    )
    try {
      await downloadChallans(
        username,
        password,
        companyName || `${username}_${companyCode}`,
        successfulCount,
        { skipNewActRadio: !anySuccessfulNewAct }
      )
      console.log("Challans downloaded successfully")
    } catch (error) {
      console.error("Error downloading challans:", error)
    }
  }

  return results
}
