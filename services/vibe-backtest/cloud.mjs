import {createDecipheriv, scryptSync} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {Sandbox} from '@vercel/sandbox'
import {cloudDatabase} from '../../lib/deployment/database.mjs'
import {publicBacktestJob, TERMINAL_BACKTEST_STATES, VIBE_BACKTEST_REPOSITORY, VIBE_BACKTEST_VERSION} from '../../lib/backtests/contract.mjs'

const MAX_SYMBOL_GROUP = 100
const MAX_PAGES = 50

export function vibeBacktestHealth(env = process.env) {
  const missing = []
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) missing.push('Supabase')
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 32) missing.push('credential encryption')
  return {ready: missing.length === 0, missing, engine: 'Vibe-Trading', version: VIBE_BACKTEST_VERSION, repository: VIBE_BACKTEST_REPOSITORY, dataProvider: 'Alpaca'}
}

export async function backtestAction(owner, method, id, input, {database = cloudDatabase(), launch = async (_job) => {}} = {}) {
  if (method === 'GET' && !id) {
    const jobs = await database(`vibe_backtest_jobs?owner_id=eq.${encodeURIComponent(owner)}&order=created_at.desc&limit=50`)
    return {health: vibeBacktestHealth(), jobs: jobs.map(row => publicBacktestJob(row))}
  }
  if (method === 'POST') {
    if (!vibeBacktestHealth().ready) throw Object.assign(new Error('Cloud backtesting is not configured.'), {status: 503})
    const id = input.id
    await database('rpc/vibe_backtest_create', {method: 'POST', body: {p_id: id, p_owner: owner, p_request: input}})
    try {
      await launch(id)
    } catch {
      await database(`vibe_backtest_jobs?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}&status=eq.queued`, {method: 'PATCH', body: {status: 'failed', stage: 'Could not start', error: 'The backtest workflow could not start.'}})
      throw Object.assign(new Error('The backtest workflow could not start.'), {status: 503})
    }
    const rows = await database(`vibe_backtest_jobs?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}`)
    return {job: publicBacktestJob(rows[0], true)}
  }
  const path = `vibe_backtest_jobs?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}`
  const rows = await database(path)
  const row = rows[0]
  if (!row) throw Object.assign(new Error('Backtest not found.'), {status: 404})
  if (method === 'GET') return {job: publicBacktestJob(row, true)}
  if (method === 'DELETE') {
    await database(path + '&status=in.(queued,running)', {method: 'PATCH', body: {status: 'cancelled', stage: 'Cancellation requested', updated_at: new Date().toISOString()}})
    return {cancelled: true}
  }
  throw Object.assign(new Error('Method not allowed.'), {status: 405})
}

function decryptCredential(payload, keyMaterial) {
  const [ivHex, tagHex, encryptedHex] = String(payload ?? '').split(':')
  if (!/^[\da-f]{24}$/i.test(ivHex ?? '') || !/^[\da-f]{32}$/i.test(tagHex ?? '') || !/^(?:[\da-f]{2})+$/i.test(encryptedHex ?? '')) throw new Error('Invalid saved credential.')
  const cipherKey = scryptSync(keyMaterial.slice(0, 32), 'tickrtalk-salt', 32)
  const decipher = createDecipheriv('aes-256-gcm', cipherKey, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8')
}

function decryptPaperCredentials(payload, keyMaterial) {
  const [ivHex, tagHex, encryptedHex] = String(payload ?? '').split(':')
  if (!/^[\da-f]{24}$/i.test(ivHex ?? '') || !/^[\da-f]{32}$/i.test(tagHex ?? '') || !/^(?:[\da-f]{2})+$/i.test(encryptedHex ?? '') || !/^[\da-f]{64}$/i.test(keyMaterial ?? '')) throw new Error('Invalid saved paper credential.')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyMaterial, 'hex'), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8'))
}

function group(items, size) {
  const output = []
  for (let offset = 0; offset < items.length; offset += size) output.push(items.slice(offset, offset + size))
  return output
}

async function alpacaBars(symbols, request, credentials, fetcher) {
  const params = new URLSearchParams({
    timeframe: '1Day', start: request.loadStartDate, end: `${request.endDate}T23:59:59Z`,
    adjustment: 'all', feed: request.feed, sort: 'asc', limit: '10000',
  })
  const all = []
  for (const symbolsPart of group(symbols, MAX_SYMBOL_GROUP)) {
    let page = ''
    for (let attempt = 0; attempt < MAX_PAGES; attempt++) {
      const query = new URLSearchParams(params)
      query.set('symbols', symbolsPart.join(','))
      if (page) query.set('page_token', page)
      const response = await fetcher(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
        method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: {'APCA-API-KEY-ID': credentials.key, 'APCA-API-SECRET-KEY': credentials.secret},
      })
      if (!response.ok) {
        if (response.status === 401) throw Object.assign(new Error('Alpaca rejected the saved paper API credentials. Check the connected Alpaca Paper account.'), {status: 422})
        if (response.status === 403) throw Object.assign(new Error(`Alpaca denied access to the selected ${request.feed.toUpperCase()} feed. Check this account’s market-data access or switch the backtest to IEX.`), {status: 422})
        if (response.status === 429) throw Object.assign(new Error('Alpaca is rate-limiting historical data. Wait a moment and retry.'), {status: 429})
        throw Object.assign(new Error('Alpaca could not return the requested historical bars.'), {status: 502})
      }
      const body = await response.json()
      for (const [symbol, bars] of Object.entries(body.bars ?? {})) {
        for (const bar of bars) {
          const values = [bar.o, bar.h, bar.l, bar.c, bar.v].map(Number)
          if (values.every(Number.isFinite) && values.slice(0, 4).every(value => value > 0)) {
            all.push(`${symbol}.US,${String(bar.t).slice(0, 10)},${values[0]},${values[1]},${values[2]},${values[3]},${values[4]}`)
          }
        }
      }
      page = body.next_page_token ?? ''
      if (!page) break
      if (attempt === MAX_PAGES - 1) throw Object.assign(new Error('Alpaca returned too many pages for this date range. Narrow the dates or symbol list.'), {status: 413})
    }
  }
  if (!all.length) throw Object.assign(new Error('Alpaca returned no usable daily bars for this date range.'), {status: 422})
  return gzipSync(Buffer.from(`symbol,date,open,high,low,close,volume\n${all.join('\n')}\n`))
}

async function ownerCredentials(owner, database, env) {
  const rows = await database(`brokerage_connections?user_id=eq.${encodeURIComponent(owner)}&broker=eq.alpaca&is_active=eq.true&paper_mode=eq.true&select=api_key_encrypted,api_secret_encrypted,paper_mode,created_at&order=created_at.desc&limit=1`)
  const row = rows[0]
  if (row?.api_key_encrypted && row?.api_secret_encrypted) {
    try {
      return {key: decryptCredential(row.api_key_encrypted, env.ENCRYPTION_KEY), secret: decryptCredential(row.api_secret_encrypted, env.ENCRYPTION_KEY)}
    } catch {
      throw Object.assign(new Error('The saved Alpaca credentials could not be read. Reconnect the account and retry.'), {status: 422})
    }
  }
  const paperRows = await database('paper_cloud_state?id=eq.1&select=body')
  const account = paperRows[0]?.body?.tables?.accounts?.find(item => item.user === owner && item.credentials)
  if (account) {
    try {
      const credentials = decryptPaperCredentials(account.credentials, env.PAPER_ENCRYPTION_KEY)
      if (typeof credentials.key === 'string' && credentials.key && typeof credentials.secret === 'string' && credentials.secret) return credentials
    } catch {
      throw Object.assign(new Error('The connected Algo Trading paper credentials could not be read. Reconnect the paper account and retry.'), {status: 422})
    }
  }
  throw Object.assign(new Error('Connect an Alpaca Paper account in Accounts or Algo Trading before running a backtest.'), {status: 428})
}

const readJson = async (sandbox, path) => {
  const bytes = await sandbox.readFileToBuffer({path})
  return bytes ? JSON.parse(bytes.toString()) : null
}

async function stopSandbox(name, sandboxFactory) {
  if (!name) return
  try { await (await sandboxFactory({name})).stop() } catch {}
}

export async function failVibeBacktest(id, {database = cloudDatabase(), sandboxFactory = options => Sandbox.get(options), error = 'The isolated backtest did not finish before its workflow run limit. Try IEX or a smaller symbol list.'} = {}) {
  const rows = await database(`vibe_backtest_jobs?id=eq.${encodeURIComponent(id)}`)
  const job = rows[0]
  if (!job) return
  await database(`vibe_backtest_jobs?id=eq.${encodeURIComponent(id)}&status=in.(queued,running)`, {method: 'PATCH', body: {status: 'failed', stage: 'Backtest stopped', error: String(error).slice(0, 1800), updated_at: new Date().toISOString()}})
  await stopSandbox(job.sandbox_name, sandboxFactory)
}

export async function vibeBacktestStep(id, {database = cloudDatabase(), sandboxFactory = options => options.runtime ? Sandbox.getOrCreate(options) : Sandbox.get(options), env = process.env, fetcher = fetch} = {}) {
  const path = `vibe_backtest_jobs?id=eq.${encodeURIComponent(id)}`
  const rows = await database(path)
  const job = rows[0]
  if (!job) return {done: true}
  if (TERMINAL_BACKTEST_STATES.has(job.status)) {
    await stopSandbox(job.sandbox_name, sandboxFactory)
    return {done: true}
  }
  const name = `tickrtalk-vibe-${id}`
  const creds = !job.runner_started ? await ownerCredentials(job.owner_id, database, env) : null
  const sandbox = job.sandbox_name
    ? await sandboxFactory({name: job.sandbox_name})
    : await sandboxFactory({name, runtime: 'python3.13', timeout: 1500000})
  if (!sandbox?.name) throw new Error('The isolated backtest runtime did not start.')
  if (!job.runner_started) {
    const request = {...job.request, requestedSymbols: job.request.symbols}
    const warmupCalendarDays = Math.ceil((request.slowWindow + 50) * 1.45)
    const loadStart = new Date(`${request.startDate}T00:00:00Z`)
    loadStart.setUTCDate(loadStart.getUTCDate() - warmupCalendarDays)
    request.loadStartDate = loadStart.toISOString().slice(0, 10)
    await database(path + '&status=eq.queued', {method: 'PATCH', body: {status: 'running', stage: 'Downloading historical daily bars', sandbox_name: sandbox.name, runner_started: true, updated_at: new Date().toISOString()}})
    const afterClaim = (await database(path))[0]
    if (!afterClaim || TERMINAL_BACKTEST_STATES.has(afterClaim.status)) {
      await sandbox.stop()
      return {done: true}
    }
    let bars
    try {
      bars = await alpacaBars(request.symbols, request, creds, fetcher)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alpaca could not provide historical market data.'
      await database(path + '&status=eq.running', {method: 'PATCH', body: {status: 'failed', stage: 'Market data unavailable', error: message.slice(0, 1800), updated_at: new Date().toISOString()}})
      await sandbox.stop()
      return {done: true}
    }
    const files = [
      {path: '/vercel/sandbox/job/request.json', content: Buffer.from(JSON.stringify(request))},
      {path: '/vercel/sandbox/job/bars.csv.gz', content: bars},
      {path: '/vercel/sandbox/requirements.txt', content: readFileSync(resolve(process.cwd(), 'services/vibe-backtest/requirements.txt'))},
      {path: '/vercel/sandbox/worker.py', content: readFileSync(resolve(process.cwd(), 'services/vibe-backtest/worker.py'))},
    ]
    await sandbox.mkDir('/vercel/sandbox/job')
    await sandbox.writeFiles(files)
  }
  const current = (await database(path))[0]
  if (!current || TERMINAL_BACKTEST_STATES.has(current.status)) {
    await sandbox.stop()
    return {done: true}
  }
  if (!await sandbox.readFileToBuffer({path: '/vercel/sandbox/job/started'})) {
    await sandbox.runCommand({cmd: 'python3', args: ['/vercel/sandbox/worker.py'], detached: true, timeoutMs: 1200000})
  }
  const done = await readJson(sandbox, '/vercel/sandbox/job/done.json')
  if (done) {
    const result = done.success ? await readJson(sandbox, '/vercel/sandbox/job/final.json') : null
    const success = !!result?.metrics && Array.isArray(result.equity)
    await database(path + '&status=eq.running', {method: 'PATCH', body: {
      status: success ? 'completed' : 'failed', stage: success ? 'Backtest ready' : 'Backtest stopped',
      result: success ? result : null,
      error: success ? null : String(done.error || 'The isolated backtest could not complete. Review the feed access and try again.').slice(0, 1800),
      updated_at: new Date().toISOString(),
    }})
    await sandbox.stop()
    return {done: true}
  }
  const progress = await readJson(sandbox, '/vercel/sandbox/job/progress.json')
  if (progress?.stage) await database(path + '&status=eq.running', {method: 'PATCH', body: {stage: String(progress.stage).slice(0, 120), updated_at: new Date().toISOString()}})
  return {done: false}
}
