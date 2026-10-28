import type {Holding,Trade} from './types'
export function nativeAccountRows(account:{id:string;currency?:{code:string};balance?:{currency?:{code:string};total?:{amount:number;currency:string}|null}},positions:unknown[],activities:unknown[]):{unknown:number;groups:{currency:string;accountId:string;holdings:Omit<Holding,'account'|'broker'>[];trades:Omit<Trade,'account'|'broker'>[]}[]}
export function moneyInCurrency(value:number|null,signed?:boolean,currency?:string):string
