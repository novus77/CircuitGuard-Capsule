export type PolicyFacts = {
  systemActive: boolean
  recipientTrusted: boolean
  recipientBlocked: boolean
  amountLow: boolean
  withinDailyBudget: boolean
  humanApproved: boolean
}

export type PolicyDecision = 'DENY' | 'ALLOW' | 'REVIEW' | 'INVALID'

export const encodePolicyFacts = (facts: PolicyFacts): number =>
  Number(facts.systemActive) |
  (Number(facts.recipientTrusted) << 1) |
  (Number(facts.recipientBlocked) << 2) |
  (Number(facts.amountLow) << 3) |
  (Number(facts.withinDailyBudget) << 4) |
  (Number(facts.humanApproved) << 5)

export const decodeDecision = (value: number): PolicyDecision =>
  value === 0 ? 'DENY' : value === 1 ? 'ALLOW' : value === 2 ? 'REVIEW' : 'INVALID'
