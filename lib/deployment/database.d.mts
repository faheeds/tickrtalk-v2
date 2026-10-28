export type CloudDatabase=(path:string,options?:{method?:string;body?:unknown;headers?:Record<string,string>})=>Promise<any>
export function cloudDatabase(env?:Record<string,string|undefined>,fetcher?:typeof fetch):CloudDatabase
