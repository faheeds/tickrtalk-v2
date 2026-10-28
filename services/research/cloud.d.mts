import type {CloudDatabase} from '../../lib/deployment/database.mjs'
export function researchAction(owner:string,method:string,id:string|null,body:unknown,options?:{database?:CloudDatabase;launch?:(id:string)=>Promise<unknown>}):Promise<unknown>
export function researchStep(id:string,options?:{database?:CloudDatabase;sandboxFactory?:(options:any)=>Promise<any>}):Promise<{done:boolean}>
export function failResearchJob(id:string,options?:{database?:CloudDatabase;sandboxFactory?:(options:any)=>Promise<any>}):Promise<void>
