export type ScreenStatus = 'pass' | 'review' | 'fail' | 'unavailable'
export type View = 'journal' | 'research' | 'algo' | 'screening' | 'accounts' | 'plans' | 'settings' | 'help' | 'owner' | 'ownerBacktests'
export type TradingStyle = 'day' | 'swing' | 'longterm'
export interface Screening {
  ticker: string; status: ScreenStatus; verdict: string; reason: string; asOf: string;
  ratios: { key: string; label: string; value: number | null; threshold: number; status: ScreenStatus }[];
  qualification?: string; source?: string; sourceUrl?: string; period?: string; cached?: boolean;
}
export interface Holding { currency?: string; symbol: string; name: string; account: string; broker: string; quantity: number; cost: number | null; price: number; color: string; screening: ScreenStatus }
export interface Trade { currency?: string; id: string; symbol: string; name: string; account: string; broker: string; date: string; side: 'Buy' | 'Sell'; quantity: number; price: number; pnl: number | null; style: TradingStyle; mode: 'paper' | 'real'; status: 'Filled' | 'Partially filled' | 'Rejected'; origin: 'algo' | 'manual' }
export interface CapitalHistory { points: {date:string;value:number}[]; flows: {date:string;amount:number}[]; flowsComplete:boolean; estimated:boolean }
export interface Account { currency?: string; id: string; broker: string; name: string; lastFour: string; coverage: number; balance: number; accountValue?:number|null; accountValueEstimated?:boolean; capital?:CapitalHistory; status: 'connected' | 'reconnect'; execution: boolean }
