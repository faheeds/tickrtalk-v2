/** @param {Request} req @param {boolean} enabled */
export function allowsLocalResearch(req, enabled) {
  if (!enabled) return false
  const url = new URL(req.url)
  const hostHeader = req.headers.get('host') ?? ''
  if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(hostHeader)) return false
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return false
  const origin = req.headers.get('origin')
  const expectedOrigin = `${url.protocol}//${hostHeader}`
  if (!['GET', 'HEAD'].includes(req.method) && origin !== expectedOrigin) return false
  return !origin || origin === expectedOrigin
}
