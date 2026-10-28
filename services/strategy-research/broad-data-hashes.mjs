import {createHash} from 'node:crypto'
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const signalFingerprint=index=>sha({protocolHash:index.protocolHash,signals:index.signals,shortlists:index.shortlists,sessions:index.sessions,stockCount:index.stockCount,eligibleCount:index.eligibleCount,sp500EligibleCount:index.sp500EligibleCount,priceAuditExclusions:index.priceAuditExclusions})
export const executionFingerprint=manifest=>sha({feed:manifest.feed,adjustment:manifest.adjustment,files:manifest.files})
