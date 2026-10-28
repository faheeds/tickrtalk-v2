import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv } from 'node:crypto'
import { backtestAction, failVibeBacktest, vibeBacktestStep } from '../services/vibe-backtest/cloud.mjs'

test('backtest history is scoped to the authenticated owner and omits result payloads', async () => {
  let path = ''
  const row = { id: 'run', owner_id: 'owner-a', status: 'completed', stage: 'Ready', created_at: 'now', updated_at: 'now', request: {}, result: { private: true } }
  const response = await backtestAction('owner-a', 'GET', null, undefined, { database: async value => { path = value; return [row] } })
  assert.match(path, /owner_id=eq.owner-a/)
  assert.equal('result' in response.jobs[0], false)
})

test('selecting a backtest by ID returns its private result payload to the authenticated owner', async () => {
  const result = {metrics: {total_return: 0.12}, equity: [{equity: '1120'}]}
  const response = await backtestAction('owner-a', 'GET', 'run', undefined, {
    database: async path => {
      assert.match(path, /id=eq.run/)
      assert.match(path, /owner_id=eq.owner-a/)
      return [{id: 'run', owner_id: 'owner-a', status: 'completed', stage: 'Ready', created_at: 'now', updated_at: 'now', request: {}, result}]
    },
  })
  assert.deepEqual(response.job.result, result)
})

test('cancellation only changes an active job owned by the authenticated user', async () => {
  const calls = []
  const database = async (path, options) => {
    calls.push({ path, options })
    if (!options) return [{ id: 'run', owner_id: 'owner-a', status: 'running', stage: 'Downloading', created_at: 'now', updated_at: 'now', request: {} }]
    return null
  }
  const response = await backtestAction('owner-a', 'DELETE', 'run', undefined, { database })
  assert.equal(response.cancelled, true)
  assert.match(calls[0].path, /owner_id=eq.owner-a/)
  assert.match(calls[1].path, /status=in.\(queued,running\)/)
  assert.equal(calls[1].options.body.status, 'cancelled')
})

test('a missing paper brokerage credential fails before an isolated runtime is created', async () => {
  const queries = []
  let sandboxCreated = false
  const database = async path => {
    queries.push(path)
    if (path.startsWith('vibe_backtest_jobs')) return [{ id: 'run', owner_id: 'owner-a', status: 'queued', request: { symbols: ['AAPL'] } }]
    return []
  }
  await assert.rejects(vibeBacktestStep('run', {
    database,
    env: { ENCRYPTION_KEY: 'a sufficiently long test encryption key', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private' },
    sandboxFactory: async () => { sandboxCreated = true; throw new Error('Unexpected sandbox creation') },
  }), /Connect an Alpaca Paper account/)
  assert.ok(queries.some(query => /paper_mode=eq.true/.test(query)))
  assert.equal(sandboxCreated, false)
})

test('backtests reuse the authenticated owner Algo paper credentials when no active broker record exists', async () => {
  const key = Buffer.alloc(32, 7)
  const iv = Buffer.alloc(12, 3)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ key: 'paper-key', secret: 'paper-secret' })), cipher.final()])
  const credentials = [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':')
  let sandboxCreated = false
  const job = { id: 'run', owner_id: 'owner-a', status: 'queued', request: { symbols: ['AAPL'] } }
  const database = async (path, options) => {
    if (path.startsWith('vibe_backtest_jobs')) {
      if (options?.method === 'PATCH') Object.assign(job, options.body)
      return [job]
    }
    if (path.startsWith('brokerage_connections')) return []
    if (path.startsWith('paper_cloud_state')) return [{ body: { tables: { accounts: [{ user: 'owner-a', credentials }] } } }]
    return []
  }
  await assert.rejects(vibeBacktestStep('run', {
    database,
    env: { ENCRYPTION_KEY: 'a sufficiently long test encryption key', PAPER_ENCRYPTION_KEY: key.toString('hex'), NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private' },
    sandboxFactory: async () => { sandboxCreated = true; throw new Error('Sandbox reached') },
  }), /Sandbox reached/)
  assert.equal(sandboxCreated, true)
})

test('an Alpaca SIP access denial fails immediately with a useful message', async () => {
  const key = Buffer.alloc(32, 7)
  const iv = Buffer.alloc(12, 3)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ key: 'paper-key', secret: 'paper-secret' })), cipher.final()])
  const credentials = [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':')
  const job = {
    id: 'run', owner_id: 'owner-a', status: 'queued', sandbox_name: null, runner_started: false,
    request: { symbols: ['AAPL'], requestedSymbols: ['AAPL'], feed: 'sip', startDate: '2024-10-01', endDate: '2026-10-25', slowWindow: 50 },
  }
  let stopped = false
  const database = async (path, options) => {
    if (path.startsWith('vibe_backtest_jobs')) {
      if (options?.method === 'PATCH') Object.assign(job, options.body)
      return [job]
    }
    if (path.startsWith('brokerage_connections')) return []
    if (path.startsWith('paper_cloud_state')) return [{ body: { tables: { accounts: [{ user: 'owner-a', credentials }] } } }]
    return []
  }
  const result = await vibeBacktestStep('run', {
    database,
    env: { ENCRYPTION_KEY: 'a sufficiently long test encryption key', PAPER_ENCRYPTION_KEY: key.toString('hex'), NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private' },
    sandboxFactory: async () => ({ name: 'sandbox', stop: async () => { stopped = true } }),
    fetcher: async () => new Response('', { status: 403 }),
  })
  assert.deepEqual(result, { done: true })
  assert.equal(job.status, 'failed')
  assert.equal(job.stage, 'Market data unavailable')
  assert.match(job.error, /denied access to the selected SIP feed/i)
  assert.equal(stopped, true)
})

test('workflow timeout details are preserved when a backtest is stopped', async () => {
  let update
  const database = async (_path, options) => {
    if (options?.method === 'PATCH') update = options.body
    return [{ id: 'run', sandbox_name: 'sandbox', status: 'running' }]
  }
  await failVibeBacktest('run', {
    database,
    sandboxFactory: async () => ({ stop: async () => {} }),
    error: 'The isolated backtest did not finish before its workflow run limit. Try IEX or a smaller symbol list.',
  })
  assert.equal(update.status, 'failed')
  assert.match(update.error, /workflow run limit/)
})
