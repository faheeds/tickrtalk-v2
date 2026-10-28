import type {PaperFill,PaperExecution,PaperPerformance} from './types'
export function tradingDate(time:string|Date):string
export function buildPerformance(input:{capital:number;started:string;fills:PaperFill[];funding?:{amount:number;time:string}[];observations?:{day:string;value:number;observedAt:string}[];now?:string}):PaperPerformance
export function groupPerformance(performance:PaperPerformance,grain:string):{key:string;date:string;value:number|null;realized:number|null;initial:boolean}[]
export function matchExecutions(fills:PaperFill[]):{executions:PaperExecution[];realized:number|null;unknown:boolean}
export function allocationCash(capital:number,fills:PaperFill[],calendar:{date:string}[],now:string|Date):{available:number;unsettled:number}
export function brokerCash(balance:Record<string,unknown>,reserved?:number):number
