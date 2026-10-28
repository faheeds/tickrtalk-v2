import type {Account,CapitalHistory} from './types'
export function normalizeCapital(history:unknown,activities:unknown[],currency:string,ledgerComplete:boolean):CapitalHistory
export function currentAccountValue(account:unknown,positions:unknown[],balances:unknown[],currency:string,singleCurrency:boolean,positionsComplete:boolean):{accountValue:number|null;accountValueEstimated:boolean}
export function capitalOverview(accounts:Account[],cutoff:string):{current:number|null;currentEstimated?:boolean;known:number;selected:number;points:{date:string;value:number}[];baseline:number[];start:number|null;end:number|null;netDeposits:number|null;gain:number|null;estimated:boolean;complete:boolean}
