/**
 * Interest under section 201(1A), recomputed from the deductee entries.
 *
 * This is the reference computation behind the '34(c) Workings' sheet. It is NOT what clause
 * 34(c) reports — 34(c) reports the interest actually shown in the TDS returns — but where the
 * computed figure exceeds the claimed one, TRACES may raise a demand for the difference.
 *
 * Basis, matching the prepared working paper:
 *   - late deduction  s.201(1A)(i)  1.0% per month or part, from credit to deduction
 *   - late payment    s.201(1A)(ii) 1.5% per month or part, from deduction to deposit
 *   - months are calendar months and part of a month counts as a full month (the TRACES basis),
 *     so the count spans both the opening and closing month inclusive
 *   - due date for deposit per Rule 30(2): 7th of the following month, and 30 April for March
 *
 * It does NOT cover interest on **short deduction** — detecting that needs the rate the law
 * required, which a conso file does not carry. Only TRACES can compute it.
 */
import type { ConsoDeductee } from "src/clause34/consoTdsParser"

export const RATE_LATE_DEDUCTION = 0.01
export const RATE_LATE_PAYMENT = 0.015

/** Rule 30(2): 7th of the following month; 30 April where the deduction month is March. */
export function depositDueDate(dateDeducted: Date): Date {
  const y = dateDeducted.getUTCFullYear()
  const m = dateDeducted.getUTCMonth() // 0-based
  if (m === 2) return new Date(Date.UTC(y, 3, 30)) // March -> 30 April
  return new Date(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 7))
}

/**
 * Calendar months spanned, counting part of a month as a whole one — so a deduction in
 * September deposited in October is 2 months, not 1.
 */
export function monthsSpanned(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  return months + 1
}

export type InterestComputation = {
  monthsLateDeduction: number
  monthsLatePayment: number
  interestLateDeduction: number
  interestLatePayment: number
  totalInterest: number
  dueDateForDeposit: Date | null
}

/** Compute the s.201(1A) interest on one deductee entry. Returns zeros when there is no default. */
export function computeInterest(entry: ConsoDeductee): InterestComputation {
  const nil: InterestComputation = {
    monthsLateDeduction: 0,
    monthsLatePayment: 0,
    interestLateDeduction: 0,
    interestLatePayment: 0,
    totalInterest: 0,
    dueDateForDeposit: null,
  }
  const { datePaid, dateDeducted, dateDeposited, tds } = entry
  if (!dateDeducted || !dateDeposited || !tds) return nil

  const dueDate = depositDueDate(dateDeducted)

  // Late deduction: tax deducted after the date of payment / credit.
  const monthsLateDeduction =
    datePaid && dateDeducted.getTime() > datePaid.getTime()
      ? monthsSpanned(datePaid, dateDeducted)
      : 0

  // Late payment: deposited after the statutory due date.
  const monthsLatePayment =
    dateDeposited.getTime() > dueDate.getTime() ? monthsSpanned(dateDeducted, dateDeposited) : 0

  const interestLateDeduction = Math.round(tds * RATE_LATE_DEDUCTION * monthsLateDeduction)
  const interestLatePayment = Math.round(tds * RATE_LATE_PAYMENT * monthsLatePayment)

  return {
    monthsLateDeduction,
    monthsLatePayment,
    interestLateDeduction,
    interestLatePayment,
    totalInterest: interestLateDeduction + interestLatePayment,
    dueDateForDeposit: dueDate,
  }
}
