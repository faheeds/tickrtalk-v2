export type ResearchPhase='development'|'validation'|'test'
export type ResearchMetrics={returnPct:number;pnl:number;trades:number;profitFactor:number|null;maximumDailyDrawdownPct:number;qualified:boolean;stressReturnPct:number}
export type StrategyResearchSummary={
 experiment:string;status:'collecting_data'|'research_complete';generatedAt:string;period:{start:string;end:string};catalogCount:number;eligibleCount:number;sp500EligibleCount:number|null;
 selected:{id:string;arm:string;setup:string;developmentQualified:boolean}|null;
 comparisons:{id:string;arm:string;setup:string;phases:Record<ResearchPhase,ResearchMetrics>}[];
 shortlistDate:string|null;shortlist:{symbol:string;relativeVolume:number;gapPct:number;screeningStatus:string;catalystStatus:string}[];
 risk:{capital:number;riskDollars:number;maxTradesPerDay:number;dailyLossDollars:number;maxHoldingMinutes:number};rejection:string[];limitations:string[];executionEnabled:false
}
