import { createClient, type SupabaseClient } from '@supabase/supabase-js'
function lazyClient(admin: boolean): SupabaseClient {
  let client: SupabaseClient | undefined
  return new Proxy({} as SupabaseClient, {
    get(_target, property) {
      if (!client) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = admin ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!url || !key) throw new Error('Account storage is not configured.')
        client = createClient(url, key, { auth: { autoRefreshToken: !admin, persistSession: !admin } })
      }
      const value = Reflect.get(client, property)
      return typeof value === 'function' ? value.bind(client) : value
    },
  })
}
export const supabase = lazyClient(false)
export const supabaseAdmin = lazyClient(true)
