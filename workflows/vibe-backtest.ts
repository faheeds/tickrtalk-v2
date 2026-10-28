import {sleep} from 'workflow'

export async function vibeBacktest(jobId: string) {
  'use workflow'
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await checkVibeBacktest(jobId)).done) return
      await sleep('30s')
    }
  } catch {
    await stopVibeBacktest(jobId, 'The isolated backtest stopped unexpectedly. Retry with IEX or a smaller symbol list.')
    return
  }
  await stopVibeBacktest(jobId, 'The isolated backtest did not finish before its workflow run limit. Try IEX or a smaller symbol list.')
}

async function checkVibeBacktest(jobId: string) {
  'use step'
  const {vibeBacktestStep} = await import('../services/vibe-backtest/cloud.mjs')
  return vibeBacktestStep(jobId)
}

async function stopVibeBacktest(jobId: string, error: string) {
  'use step'
  const {failVibeBacktest} = await import('../services/vibe-backtest/cloud.mjs')
  await failVibeBacktest(jobId, {error})
}
