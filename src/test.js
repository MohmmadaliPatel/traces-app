const puppeteer = require("puppeteer-extra")

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require("puppeteer-extra-plugin-stealth")
puppeteer.use(StealthPlugin())

const test = async () => {
  // Launch a headless browser
  const browser = await puppeteer.launch({
    headless: false,
    // executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      "--start-maximized", // you can also use '--start-fullscreen'
    ],
  })

  // Open a new page
  const page = await browser.newPage()
  const udin = await getUdin(page)
  // await fillForm(page)
}

async function getUdin(page) {
  await page.goto('https://udin.icai.org/')
  await page.type('#username', '173901')
  await page.type('#exampleInputPassword1', '49a77eafbc2c')
  await page.waitForSelector('#MrnNumberGen', { timeout: 300000 });
  await page.type('#memberPan', 'EHPPS7819B')
  await page.select('#FirmRegistrationNumber', '159382W')

  const modalSelector = '#dialog-confirm_frn button.btn.btn-primary'
  if (await page.$(modalSelector)) {
    await delay(2000)
    await page.click(modalSelector);
  }
  await page.evaluate(() => {
    document.querySelectorAll('label.documentTypeLabel').forEach(l => l.innerHTML === 'Certificates' && l.click())
  })
  await delay(2000)
  await page.evaluate(() => {
    $('#DocumentTypesSub').val('16').trigger('chosen:updated')
  })
  await page.evaluate(() => {
    $("#DocumentDate").datepicker().datepicker("setDate", "today");
  })
  await page.type('#itemName1', 'payable amount in foreign currency')
  await page.type('#keywordName1', '10000')
  await page.type('#itemName2', 'tax liablity')
  await page.type('#keywordName2', '1000')
  await page.type('#DocumentType2', 'Form 15CB issued for foriegn payment')
  await page.click('#GenerateUDINOTPbtn')

  await page.waitForSelector('#GenUdinForm', { timeout: 300000 });
  const udin = await page.$eval('#GenUdinForm span', element => element.innerHTML);
  console.log({ udin });
  return udin
}
async function fillForm(page) {

  // Navigate to a website
  await page.goto("https://eportal.incometax.gov.in/iec/foservices/#/login")

  // Click a button that triggers XHR requests
  await login(page, "ARCA173901", "Cahardik@93")

  await page.evaluate(() => {
    setTimeout(() => {
      location.href = "#/dashboard/fileIncomeTaxForm"
      setTimeout(() => {
        window["$"]("#securityReasonPopup").modal("hide")
      }, 1000)
    }, 2000)
  })
  await delay(10000)
  await page.click("#mat-tab-label-0-1")

  const [fileNowSpan] = await page.$x(
    "//*[@id[contains(., 'tabGroupIncomeTax')]]//span[contains(text(), '(Form 15CB)')]"
  )
  if (fileNowSpan) {
    await fileNowSpan.click()
  } else {
    console.error("File Now span not found")
  }
  await delay(2000)
  await page.evaluate(() => {
    document.querySelector("mat-radio-group").children[0].children[0].click()
  })

  await fillDropdown(page, 'mat-select[formcontrolname="fincialYr"]', "2023-24")
  await delay(1000)
  await (
    await page.$x(
      "//button[contains(text(), 'Continue') and contains(@class, 'large-button-primary')]"
    )
  )[0].click()
  await page.waitForNavigation()
  await (await page.$$(".largeButton "))[1].click()

  // Wait for the input field to appear
  await page.waitForSelector("#panAdhaarUserId")

  // Input text into the input field
  await page.type("#panAdhaarUserId", "AAACS9939D")
  await page.click("#upButtonSaveDraft")
  await delay(2000)
  try {
    await certificateDetails(page)
    await delay(1000)
    await remeteeDetails(page)
    await itaDetails(page)
    await dtaaDetails(page)
    await remetanceDetails(page)
    await accountantDetails(page)
    await page.click(".large-button-primary")

  } catch (error) {
    console.log(error)
  }
}
async function login(page, username, password) {
  await page.waitForSelector('input[name="panAdhaarUserId"]') // Replace with your button selector
  await page.type('input[name="panAdhaarUserId"]', username.toUpperCase())
  await page.click(".large-button-primary.width.marTop16")
  await page.waitForSelector("#passwordCheckBox-input") // Replace with your button selector
  await page.click("#passwordCheckBox-input")
  await page.type('input[name="loginPasswordField"]', password)
  await page.waitForTimeout(5000)
  await page.click(".large-button-primary.width.marTop26")
  try {
    await page.waitForTimeout(5000)
    const [loginHereElement] = await page.$x("//button[text()=' Login Here ']")
    if (loginHereElement) {
      loginHereElement.click()
    }
  } catch (error) { }
}

async function certificateDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("mat-panel-title span").forEach((s) => {
      if (s.innerHTML.toLowerCase().includes("certification")) {
        s.click()
      }
    })
  })
  await fillDropdown(page, "#verSalut", formdata.Beneficiary.Group.Firm.IorWe)
  await fillDropdown(
    page,
    "#verRemitterTitle",
    (formdata.Beneficiary.Branch?.Honorific || formdata.Beneficiary.Company.Honorific) + "."
  )
  await fillDropdown(page, "#verRemitteeTitle", formdata.Beneficiary.BenefeciaryPrefix + ".")
  await page.type("#verRemitteeName", formdata.Beneficiary.BenefeciaryName)
  await page.click(".large-button-primary")
}

async function accountantDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("mat-panel-title span").forEach((s) => {
      if (s.innerHTML.toLowerCase().includes("accountant details")) {
        s.click()
      }
    })
  })

  await page.type('#accFirmName', "Taxteck 123")
  await page.type('#accFirmRegNum', "55555555")
  await page.type('#form15cbUserInputPlace', "Mumbai")
  await page.click(".large-button-primary")

}

async function remeteeDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("mat-panel-title span").forEach((s) => {
      if (s.innerHTML.toLowerCase().includes("remittee (recipient) details")) {
        s.click()
      }
    })
  })
  await fillDropdown(page, "#country", formdata.Beneficiary.Country)
  await page.type("#addrLine1", formdata.Beneficiary.Flat)
  await page.type("#addrLine2", formdata.Beneficiary.Building || "")

  if (formdata.Beneficiary.Country.toLowerCase() === "india") {
    await page.type("#pincode", formdata.Beneficiary.Pincode)
    await delay(2000)
  } else {
    await page.type("#zipcode", formdata.Beneficiary.Pincode)
    // await page.type("#foreignPostOffice", formdata.Beneficiary.Pincode)
    await page.type("#foreignLocality", formdata.Beneficiary.Locality || "")
    await page.type("#foreignDistrict", formdata.Beneficiary.City || "")
  }
  await page.click(".large-button-primary")
}

async function remetanceDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("mat-panel-title span").forEach((s) => {
      if (s.innerHTML.toLowerCase().includes("remittance details (fund transfer)")) {
        s.click()
      }
    })
  })
  await fillDropdown(page, "#remittanceCountry", formdata.RemittanceCountry)
  await fillDropdown(page, "#remittanceCcy", "USD")
  await page.type("#payableAmt", formdata.PayableAmountINR.toString())
  await page.type("#payableForgnCcyAmt", formdata.PayableAmountInForeign.toString())
  await page.type('#ifsc', 'ICIC0000020')
  await delay(2000)

  await page.type("#bankBsrCode", formdata.BSRCode)
  await fillDropdown(page, "#nameOfAuthorizedDealer", 'AB Bank Limited')
  await fillDropdown(page, "#branchAddressOfTheAuthorizedDealer", 'Liberty Building, 41-42, Sir Vithaldas T Marg, New Marine Lines, Mumbai 400 020.')

  await fillDropdown(page, "#remittanceNature", formdata.NatureOfRemittance)
  const othertext = await page.$("#remittanceNatureOthTxt")
  if (othertext) {
    page.type("#remittanceNatureOthTxt", formdata.OtherRemittanceNameOnDocument)
  }
  await fillDropdown(page, "#purpose", formdata.RBIPurposeCode)
  await fillDropdown(page, "#subPurpose", formdata.SubCategory)

  if (formdata.IsTaxPayableGrossedUp) {
    page.evaluate(() =>
      document.querySelectorAll("#grossTaxFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )
  } else {
    page.evaluate(() =>
      document.querySelectorAll("#grossTaxFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
  }
  selectDate(page, formdata.ProposedDate, 'remittanceDt')
  await await page.click(".large-button-primary")
}

async function itaDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("mat-panel-title span").forEach((s) => {
      if (s.innerHTML.toLowerCase().includes("taxability under income-tax act (without dtaa)")) {
        s.click()
      }
    })
  })
  if (formdata.IsRemittanceChargeableIndia) {
    await page.evaluate(() =>
      document.querySelectorAll("#indiaTaxFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )
    await page.type("#remittanceSecAct", formdata.SectionOfActRemittanceCovered)
    await page.type("#remittanceAmt", formdata.IncomeChargeableToTax.toString())
    await page.type("#taxLiabAmt", formdata.TaxLiability.toString())
    await page.type("#taxRsnTxt", formdata.DeterminingTaxAndLiability)
  } else {
    await page.evaluate(() =>
      document.querySelectorAll("#indiaTaxFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
    page, type("#reasonsThereOf", formdata.ReasonRemittanceNotChargeable)
  }
  await page.click(".large-button-primary")
}

async function dtaaDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("mat-panel-title span").forEach((s) => {
      if (
        s.innerHTML.toLowerCase().includes("taxability under  income-tax act (with dtaa relief)")
      ) {
        s.click()
      }
    })
  })

  if (formdata.TaxResidencyCertificateObtained) {
    await page.evaluate(() =>
      document.querySelectorAll("#taxResCertFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )
  } else {
    await page.evaluate(() =>
      document.querySelectorAll("#taxResCertFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
  }

  await page.type("#relDtaa", formdata.CertificateDTAA || "")
  await page.type("#relDtaa", formdata.dtaaArticle || "")
  await page.type("#taxIncDtaaAmt", formdata.DTAATaxableIncome?.toString() || "")
  await page.type("#taxLiabDtaaAmt", formdata.DTAATaxLiability?.toString() || "")

  if (formdata.IsWithPermanentEstablishment) {
    await page.evaluate(() =>
      document.querySelectorAll("#nonPeFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )
    await page.type("#nonPeDtaaArticle", formdata.PermanentEstablishmentArticle?.toString() || "")
    await page.type("#tdsDtaaRt", formdata.PermanentEstablishmentRateOfTDS?.toString() || "")
  } else {
    await page.evaluate(() =>
      document.querySelectorAll("#nonPeFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
  }

  if (formdata.IsAccountOfBusinessIncome) {
    await page.evaluate(() =>
      document.querySelectorAll("#bussIncFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )

    if (formdata.SuchIncomeLiableToTaxIN) {
      await page.evaluate(() =>
        document.querySelectorAll("#bussIncIndiaTaxFlag .mat-radio-label-content").forEach((l) => {
          if (l.innerHTML.includes("Yes")) {
            l.click()
          }
        })
      )
      await page.type("#bussIncTaxRsnTxtYesFlag", formdata.IfBasisOfTheRateOfDeduction)
    } else {
      await page.evaluate(() =>
        document.querySelectorAll("#bussIncIndiaTaxFlag .mat-radio-label-content").forEach((l) => {
          if (l.innerHTML.includes("No")) {
            l.click()
          }
        })
      )
      await page.type("#bussIncTaxRsnTxtNoFlag", formdata.NoTaxableInIndiaDTAA)
    }
  } else {
    await page.evaluate(() =>
      document.querySelectorAll("#bussIncFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
  }

  if (formdata.IsRemittanceCapitalGains) {
    await page.evaluate(() =>
      document.querySelectorAll("#capGainFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )
    await page.type("#ltcgAmt", formdata.AmountOfCapitalGains?.toString() || "")
    await page.type("#stcgAmt", formdata.AmountOfShortCapitalGains?.toString() || "")
    await page.type("#capGainTaxRsnTxt", formdata.BasisOfTaxableIncome || "")
  } else {
    await page.evaluate(() =>
      document.querySelectorAll("#capGainFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
  }

  if (formdata.IsRemittanceCovered) {
    await page.evaluate(() =>
      document.querySelectorAll("#othRemittanceFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )
    await page.type("#ltcgAmt", formdata.AmountOfCapitalGains?.toString() || "")
  } else {
    await page.evaluate(() =>
      document.querySelectorAll("#othRemittanceFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
  }

  if (formdata.TaxableInIndiaDTAA) {
    await page.evaluate(() =>
      document.querySelectorAll("#othIndiaTaxFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("Yes")) {
          l.click()
        }
      })
    )
    await page.type("#othTdsRrt", formdata.YesTaxableInIndiaDTAA?.toString() || "")
  } else {
    await page.evaluate(() =>
      document.querySelectorAll("#othIndiaTaxFlag .mat-radio-label-content").forEach((l) => {
        if (l.innerHTML.includes("No")) {
          l.click()
        }
      })
    )
    await page.type("#othRsnTxt", formdata.NoReasonRelevantArticleDTAA || "")
  }

  await page.type("#tdsAmt", formdata.AmountOfTDSInINR?.toString() || "")
  await page.type("#tdsForgnCcyAmt", formdata.AmountOfTDSInForeign?.toString() || "")
  await fillDropdown(page, "#rateTDS", formdata.RateOfTDSIncomeTaxAct)
  await page.type("#tdsDtaaRate", formdata.RateOfTDS?.toString() || "")
  await page.type("#totRemittanceAmt", formdata.AmountAfterTDS?.toString() || "")

  selectDate(page, formdata.DateOfDeduction, 'deductionDt')
  await page.click(".large-button-primary")
}

async function fillDropdown(page, ddSelector, value) {
  await page.evaluate(
    ([ddSelector, value]) => {
      document.querySelector(ddSelector).click()
      document.querySelectorAll("mat-option").forEach((opt) => {
        if (
          opt.querySelector(".mat-option-text").innerHTML.toLowerCase().trim() ===
          value.toLowerCase()
        ) {
          opt.click()
        }
      })
    },
    [ddSelector, value]
  )
}

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time)
  })
}

async function selectDate(page, date, dateSelector) {
  await page.evaluate(([dateStr, dateSelector]) => {
    const date = new Date(dateStr)
    const months = {
      0: "January",
      1: "February",
      2: "March",
      3: "April",
      4: "May",
      5: "June",
      6: "July",
      7: "August",
      8: "September",
      9: "October",
      10: "November",
      11: "December",
    }

    document.querySelector(`#${dateSelector}`).click()
    document.querySelector('button[aria-label="Choose month and year"]').click()
    document.querySelector(`td[aria-label="${date.getFullYear()}"]`).click()
    document
      .querySelector(`td[aria-label="${months[date.getMonth()]} ${date.getFullYear()}"]`)
      .click()
    document
      .querySelector(
        `td[aria-label="${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}"]`
      )
      .click()
  }, [date, dateSelector])
}

const formdata = {
  id: 17,
  Form15CAC: {
    id: 2,
    __typename: "Form15CAC",
  },
  RevokedToId: null,
  RevokedFrom: null,
  RevokedToForm: null,
  Beneficiary: {
    id: 3,
    BenefeciaryName: "Google",
    PAN: "",
    Flat: "2",
    Locality: "2",
    Building: null,
    Country: "UNITED STATES OF AMERICA",
    State: "New York",
    Street: null,
    OtherCountry: null,
    Pincode: "99304",
    BusinessPlace: "USA",
    BenefeciaryStatus: "Company",
    BenefeciaryEmail: null,
    BenefeciaryPhone: null,
    Company: {
      id: 3,
      ClientApproval: false,
      __typename: "Company",
    },
    Document: [],
    __typename: "Benefeciary",
    Group: {
      Firm: {
        IorWe: "I",
      },
    },
    Company: {
      CompanyName: "Demo Company Limited",
      Honorific: "M/s",
    },
    Branch: null,
    BenefeciaryPrefix: "M/s",
  },
  createdAt: "2024-02-11T09:40:48.965Z",
  updatedAt: "2024-02-11T09:40:48.966Z",
  CreatedBy: 23,
  UpdatedBy: null,
  Flat: "2",
  Building: null,
  Street: null,
  Locality: "2",
  City: "New York",
  State: "New York",
  Country: "UNITED STATES OF AMERICA",
  Pincode: "99304",
  RemittanceCountry: "UNITED STATES OF AMERICA",
  OtherRemittanceCountry: null,
  RemittanceCurrency: "US DOLLAR",
  OtherRemittanceCurrency: null,
  PayableAmountInForeign: 100.97,
  ExchangeRate: "83",
  PayableAmountINR: 8380.51,
  BankName: "HDFC Bank Ltd",
  BranchName: "Powai",
  BSRCode: "1234567",
  ProposedDate: "2024-03-30T00:00:00.000Z",
  RemittanceNameOnDocument: "OTHER INCOME / OTHER (NOT IN THE NATURE OF INCOME)",
  OtherRemittanceNameOnDocument: "ABCS",
  RBIPurposeCode: "Other Business Services",
  SubCategory: "S1099 - Other services not included elsewhere",
  IsTaxPayableGrossedUp: true,
  IsRemittanceChargeableIndia: true,
  ReasonRemittanceNotChargeable: "",
  SectionOfActRemittanceCovered: "Section 9(1)(vi)",
  IncomeChargeableToTax: 10581.45,
  TaxLiability: 20054.14,
  DeterminingTaxAndLiability: "Section 9(1)(vi)",
  IncomeTaxRateOfTDS: 20.8,
  ChargeableAndReliefDTAA: true,
  TaxResidencyCertificateObtained: false,
  TaxResidencyCertificateMade: false,
  CertificateDTAA: "India - USA",
  CertificateArticleOfDTAA: "Article 12",
  DTAATaxableIncome: 9311.68,
  DTAATaxLiability: 931.17,
  IsWithPermanentEstablishment: true,
  PermanentEstablishmentArticle: "Article 12",
  PermanentEstablishmentRateOfTDS: 10,
  IsAccountOfBusinessIncome: false,
  SuchIncomeLiableToTaxIN: false,
  IfBasisOfTheRateOfDeduction: "",
  NoReasonRelevantArticleDTAA: "NA",
  IsRemittanceCapitalGains: false,
  AmountOfCapitalGains: null,
  AmountOfShortCapitalGains: null,
  BasisOfTaxableIncome: "",
  CapitalGainsRateOfTDS: null,
  IsRemittanceCovered: false,
  NatureOfRemittance: "Amc Charges",
  TaxableInIndiaDTAA: false,
  YesTaxableInIndiaDTAA: null,
  NoTaxableInIndiaDTAA: "",
  IsRelatedParty: false,
  TransactionLengthPrice: false,
  RateOfTDSIncomeTaxAct: "AS PER INCOME-TAX ACT",
  RateOfTDS: "20.8",
  AmountOfTDSInForeign: 241.62,
  AmountOfTDSInINR: 20054.14,
  AmountAfterTDS: 678.38,
  DateOfDeduction: "2024-02-13T00:00:00.000Z",
  AccountantName: "Dipesh Ruparelia",
  AccountantFirmName: "H S D R & Associates",
  AccountantFlat: "902",
  AccountantBuilding: "Pushp Vinod 3",
  AccountantStreet: "SV Road",
  AccountantLocality: "Borivali West",
  AccountantCity: "Mumbai",
  AccountantState: "Maharashtra",
  AccountantCountry: "INDIA",
  AccountantPincode: "400092",
  AccountantMembershipNumber: "190806",
  AccountantRegistrationNumber: "0159382W",
  BankDetailId: 3,
  Events: [
    {
      id: 48,
      status: "Draft",
      isLatest: false,
      comments: "",
      createdAt: "2024-02-11T09:40:48.965Z",
      CertificateDate: null,
      AckNumber: null,
      UDIN: null,
      CreatedBy: {
        id: 23,
        FirstName: "Dipesh",
        LastName: "Ruparelia",
        __typename: "User",
      },
      Document: null,
      __typename: "Events",
    },
    {
      id: 49,
      status: "Finalised",
      isLatest: false,
      comments: "",
      createdAt: "2024-02-11T09:40:48.965Z",
      CertificateDate: null,
      AckNumber: null,
      UDIN: null,
      CreatedBy: {
        id: 23,
        FirstName: "Dipesh",
        LastName: "Ruparelia",
        __typename: "User",
      },
      Document: null,
      __typename: "Events",
    },
    {
      id: 50,
      status: "Uploaded",
      isLatest: true,
      comments: "",
      createdAt: "2024-02-11T09:41:14.200Z",
      CertificateDate: "2024-02-11T00:00:00.000Z",
      AckNumber: "123456789123456",
      UDIN: "12345678912345678A",
      CreatedBy: {
        id: 23,
        FirstName: "Dipesh",
        LastName: "Ruparelia",
        __typename: "User",
      },
      Document: {
        file: {
          path: "uploads/1707644473859.pdf",
          filename: "1707644473859.pdf",
          __typename: "File",
        },
        __typename: "Document",
      },
      __typename: "Events",
    },
  ],
  Document: [],
  RequestId: null,
  Request: null,
  __typename: "Form15CB",
}
test()
