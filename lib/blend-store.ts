/** Supabase implementation of the blend ledger (service-role client; every query is scoped by user id). */
import { supabaseAdmin } from '@/lib/supabase'
import type { BlendStore, LedgerRow, LedgerPatch, NewEntry } from '@/lib/blend-runner'

const LIVE = ['pending_entry', 'open', 'pending_exit']
const COLS = 'id, sleeve, symbol, status, target_qty, qty, ref_price, entry_price, entry_date, entry_client_id, exit_client_id'

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x))

export function supabaseBlendStore(userId: string): BlendStore {
  return {
    async listLive() {
      const { data, error } = await supabaseAdmin.from('blend_positions').select(COLS)
        .eq('user_id', userId).in('status', LIVE)
      if (error) throw new Error(`ledger read failed: ${error.message}`)
      return (data ?? []).map(r => ({
        ...r, ref_price: num(r.ref_price), entry_price: num(r.entry_price),
      })) as LedgerRow[]
    },

    async insertEntry(e: NewEntry) {
      const { data, error } = await supabaseAdmin.from('blend_positions').insert({
        user_id: userId, sleeve: e.sleeve, symbol: e.symbol, status: 'pending_entry',
        target_qty: e.target_qty, ref_price: e.ref_price, entry_date: e.entry_date,
        entry_reason: e.entry_reason, entry_client_id: e.entry_client_id,
      }).select('id').single()
      if (error || !data) return { ok: false as const, message: error?.code === '23505' ? 'already open or ordered' : (error?.message ?? 'insert failed') }
      return { ok: true as const, id: data.id as string }
    },

    async update(id: string, patch: LedgerPatch) {
      const { error } = await supabaseAdmin.from('blend_positions').update(patch).eq('id', id).eq('user_id', userId)
      if (error) throw new Error(`ledger update failed: ${error.message}`)
    },

    async setLastRebalanceMonth(month: string) {
      await supabaseAdmin.from('blend_config').update({ last_rebalance_month: month }).eq('user_id', userId)
    },
  }
}
