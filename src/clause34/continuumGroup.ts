/**
 * The Continuum group as reported in the FY 2025-26 clause 34(b) working paper.
 *
 * Name and PAN are the assessee details carried on each company sheet; `sheet` is that sheet's
 * tab name, kept stable so a regenerated workbook lines up with the original.
 */
export type Clause34Entity = {
  sr: number
  /** Name as TRACES reports it. */
  name: string
  tan: string
  pan: string
  /** Worksheet tab name. */
  sheet: string
}

export const CONTINUUM_GROUP: Clause34Entity[] = [
  {
    sr: 1,
    name: "BOTHE WINDFARM DEVELOPMENT PRIVATE LIMITED",
    tan: "MUMB21329A",
    pan: "AAECB5678G",
    sheet: "Bothe Windfarm",
  },
  {
    sr: 2,
    name: "CGE HYBRID ENERGY PRIVATE LIMITED",
    tan: "MUMC28021A",
    pan: "AAJCC9626L",
    sheet: "CGE Hybrid",
  },
  {
    sr: 3,
    name: "CGE II HYBRID ENERGY PRIVATE LIMITED",
    tan: "MUMD30267G",
    pan: "AAICD9381L",
    sheet: "CGE II Hybrid",
  },
  {
    sr: 4,
    name: "CGE RENEWABLES PRIVATE LIMITED",
    tan: "MUMC27789G",
    pan: "AAJCC7814N",
    sheet: "CGE Renewables",
  },
  {
    sr: 5,
    name: "CGE SHREE DIGVIJAY CEMENT GREEN ENERGY PRIVATE LIMITED",
    tan: "MUMT26205E",
    pan: "AAJCT0513B",
    sheet: "CGE Shree Digvijay",
  },
  {
    sr: 6,
    name: "CONTINUUM GREEN ENERGY LIMITED",
    tan: "CHES27959B",
    pan: "AAKCS8353F",
    sheet: "Continuum Green Energy",
  },
  {
    sr: 7,
    name: "CONTINUUM MP WINDFARM DEVELOPMENT PRIVATE LIMITED",
    tan: "MUMC21400B",
    pan: "AAGCC1039G",
    sheet: "Continuum MP Windfarm",
  },
  {
    sr: 8,
    name: "CONTINUUM POWER TRADING (TN) PRIVATE LIMITED",
    tan: "CHEC12453A",
    pan: "AAHCC2434N",
    sheet: "Continuum Power Trading TN",
  },
  {
    sr: 9,
    name: "CONTINUUM TRINETHRA RENEWABLES PRIVATE LIMITED",
    tan: "MUMC26390A",
    pan: "AAICC8209J",
    sheet: "Continuum Trinethra",
  },
  {
    sr: 10,
    name: "DJ ENERGY PRIVATE LIMITED",
    tan: "DELD11445A",
    pan: "AACCD9286G",
    sheet: "DJ Energy",
  },
  {
    sr: 11,
    name: "DALAVAIPURAM RENEWABLES PRIVATE LIMITED",
    tan: "MUMD29873E",
    pan: "AAICD6642E",
    sheet: "Dalavaipuram",
  },
  {
    sr: 12,
    name: "JAMNAGAR RENEWABLES ONE PRIVATE LIMITED",
    tan: "MUMJ26571G",
    pan: "AAGCJ4348B",
    sheet: "Jamnagar One",
  },
  {
    sr: 13,
    name: "JAMNAGAR RENEWABLES TWO PRIVATE LIMITED",
    tan: "MUMJ26572A",
    pan: "AAGCJ4355E",
    sheet: "Jamnagar Two",
  },
  {
    sr: 14,
    name: "KUTCH WINDFARM DEVELOPMENT PRIVATE LIMITED",
    tan: "MUMK28963E",
    pan: "AAHCK3379A",
    sheet: "Kutch Windfarm",
  },
  {
    sr: 15,
    name: "MORJAR RENEWABLES PRIVATE LIMITED",
    tan: "MUMM61129F",
    pan: "AAPCM2401H",
    sheet: "Morjar Renewables",
  },
  {
    sr: 16,
    name: "MORJAR WINDFARM DEVELOPMENT PRIVATE LIMITED",
    tan: "MUMM56138F",
    pan: "AAMCM7253N",
    sheet: "Morjar Windfarm",
  },
  {
    sr: 17,
    name: "RENEWABLES TRINETHRA PRIVATE LIMITED",
    tan: "MUMR40488A",
    pan: "AAJCR6524N",
    sheet: "Renewables Trinethra",
  },
  {
    sr: 18,
    name: "TRINETHRA WIND AND HYDRO POWER PRIVATE LIMITED",
    tan: "MUMT18184F",
    pan: "AADCT0749B",
    sheet: "Trinethra Wind & Hydro",
  },
  {
    sr: 19,
    name: "UTTAR URJA PROJECTS PRIVATE LIMITED",
    tan: "MUMU10439C",
    pan: "AABCU0227H",
    sheet: "Uttar Urja",
  },
  {
    sr: 20,
    name: "WATSUN INFRABUILD PRIVATE LIMITED",
    tan: "MUMW04565B",
    pan: "AAACW9841N",
    sheet: "Watsun Infrabuild",
  },
]

export const CONTINUUM_TANS: string[] = CONTINUUM_GROUP.map((e) => e.tan)

export function entityByTan(tan: string): Clause34Entity | undefined {
  return CONTINUUM_GROUP.find((e) => e.tan === tan.toUpperCase())
}
