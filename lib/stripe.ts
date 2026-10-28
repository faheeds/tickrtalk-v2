import Stripe from 'stripe'

let stripeClient: Stripe | undefined
export const stripe = new Proxy({} as Stripe, { get(_target, property) {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Billing is not configured.')
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16', typescript: true })
  }
  return Reflect.get(stripeClient, property)
} })

export const PLANS = {
  basic: {
    name: 'Basic',
    priceId: process.env.STRIPE_BASIC_PRICE_ID!,
    price: 19,
    features: ['Halal screening', 'Portfolio tracking', 'Personal watchlist', '1 broker connection'],
  },
  pro: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    price: 49,
    features: ['Everything in Basic', 'AI algo engine', 'Auto-trading', 'All broker connections', 'Cron scans every 5 min'],
  },
} as const

export type PlanKey = keyof typeof PLANS
