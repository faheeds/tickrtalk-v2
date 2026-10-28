export function sessionPriceFactor(adjusted,raw){
 if(!adjusted||!raw||!(adjusted.o>0&&raw.o>0))throw new Error('Matching raw and adjusted opening prices are required.')
 if(adjusted.t&&raw.t&&adjusted.t.slice(0,10)!==raw.t.slice(0,10))throw new Error('Raw and adjusted dates differ.')
 const ratio=raw.o/adjusted.o
 if(!Number.isFinite(ratio)||ratio<=0||ratio>1000000)throw new Error('Invalid historical split scale.')
 // Adjusted OHLC can be rounded to cents. Infer a simple split ratio from the
 // opening prices and corroborate it against all prices and adjusted volume.
 // Volume is used only as a corporate-action consistency check, never as alpha.
 const valid=factor=>factor>0&&['o','h','l','c'].every(field=>Number.isFinite(raw[field])&&Number.isFinite(adjusted[field])&&Math.abs(adjusted[field]*factor-raw[field])<=.0051*Math.max(1,factor)+.0001)&&(!(raw.v>0&&adjusted.v>0)||Math.abs(adjusted.v/factor-raw.v)<=Math.max(2,1/factor+1,raw.v*.000001))
 for(let denominator=1;denominator<=1000;denominator++){const numerator=Math.round(ratio*denominator),factor=numerator/denominator;if(valid(factor))return factor}
 if(valid(ratio))return ratio
 throw new Error('Raw and adjusted daily prices do not share a consistent split scale.')
}
export function nominalSession(day,factor){
 if(!Number.isFinite(factor)||factor<=0)throw new Error('A positive session price scale is required.')
 const scale=value=>Math.round(value*factor*1000000)/1000000
 const convert=b=>({...b,o:scale(b.o),h:scale(b.h),l:scale(b.l),c:scale(b.c),...(Number.isFinite(b.vwap)?{vwap:scale(b.vwap)}:{})})
 return {...day,opening:day.opening?convert(day.opening):null,bars:day.bars.map(convert)}
}
export function nominalFeatures(features,factor){if(!Number.isFinite(factor)||factor<=0)throw new Error('A positive indicator price scale is required.');return features?Object.fromEntries(Object.entries(features).map(([key,value])=>[key,value*factor])):null}
