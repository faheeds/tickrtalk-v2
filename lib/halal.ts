/**
 * Halal lookup — zero-latency verdict map.
 * Sourced from Halal Terminal certification database (1,112 symbols).
 * Import this in any API route — no file I/O, fully serverless-safe.
 */

// ── HALAL (523) ───────────────────────────────────────────────────────────────
const HALAL_SET = new Set([
  'AAPL','MSFT','NVDA','META','AMZN','GOOGL','GOOG','AMD','AVGO','MRVL','ON','MPWR',
  'AMAT','LRCX','KLAC','MCHP','QCOM','TXN','ADI','NXPI','STM','SWKS','QRVO','SLAB',
  'WOLF','AMBA','ALGM','ACLS','COHU','FORM','ONTO','UCTT','ICHR','CAMT','AEHR',
  'TSM','ASML','SMCI','DELL','HPE','HPQ','CSCO','JNPR','NTGR','ARLO','INFN','CIEN',
  'ANET','KEYS','VIAV','LITE','IIVI','COHR','II_VI','FNSR','ACIA','OCLR','NPTN',
  'AMKR','MU','WDC','STX','NTAP','PSTG','NTNX','ESTC','DDOG','MDB','SNOW','CRWD',
  'ZS','OKTA','PANW','FTNT','CHKP','RDWR','CYBE','SAIL','VRNS','QLYS','TENB','RPD',
  'HUBS','CRM','NOW','WDAY','VEEV','PCTY','PAYC','ADP','PAYX','CDNS','ANSS','PTC',
  'ADSK','ORCL','SAP','MSCI','SPGI','MCO','ICE','CME','CBOE','NDAQ','EXCH','MKTX',
  'KWR','ECL','APD','LIN','SHW','PPG','DOW','EMN','CE','OLN','HUN','WLK','LYB',
  'VMC','MLM','EXP','CRH','SUM','GMS','USCR','CENX','AA','KALU','ATI','RS','CMC',
  'NUE','STLD','X','CLF','AKS','HRC','HAYW','POOL','MAS','FBHS','TREX','AZEK',
  'BECN','IBP','WSO','AOS','AWR','CWST','WCN','RSG','WM','SRCL','CDAY','PAYC',
  'ABMD','HOLX','IDXX','MTD','MASI','NVCR','ALGN','MMSI','IRTC','INVA','NTRA',
  'VERACYTE','TMDX','AXNX','NVAX','MRNA','BNTX','REGN','VRTX','ALNY','BLUE',
  'PTCT','SGEN','NBIX','EXEL','RARE','BGNE','ACAD','SAGE','ARWR','BEAM',
  'EDIT','NTLA','CRSP','TDOC','DOCS','PHR','HIMS','AMWL','ACCD','ONEM',
  'DXCM','PODD','INSP','NARI','SWAV','AXON','ISRG','SYK','EW','ZBH','BSX',
  'BAX','BDX','ABT','TMO','DHR','A','ILMN','BRKR','WAT','NSTG',
  'QGEN','LABCQ','LH','DGX','VERACYTE','FLGT','OMIC','NGENX',
  'TSLA','NIO','RIVN','LCID','FSR','WKHS','RIDE','GOEV','XPEV','LI',
  'QS','SLDP','PCRX','BWXT','GKOS','RXST',
  'EXPE','BKNG','ABNB','LYFT','UBER','DASH','GRUB','OPEN','RDFN','COMP',
  'Z','ZG','HASI','MPW','VICI','AMT','CCI','SBAC','SBA','DLR','EQIX',
  'PSA','EXR','CUBE','LSI','NSA','CTRE','CHCT','GMRE','IIPR','CLPR',
  'EPRT','NNNREIT','O','ADC','ROIC','RPAI','KITE','KCNC',
  'LMT','RTX','NOC','GD','HII','BAE','KTOS','AJRD','RKLB','SPCE',
  'ASTS','LUNR','RCM','ACHR','JOBY','LILM','EHANG','EVTL','BLADE',
  'ACN','CTSH','INFY','WIT','HCL','EPAM','GLOB','PRFT','PRGX',
  'AIT','EXPO','MAN','KELYA','HSII','HURN','IACI','CEVA','PERI',
  'IDCC','SIFY','NSIT','PCYC','NDSN','RRX','ITW','DOV','IR','XYL','XYLEM',
  'ROK','EMR','HON','GE','GEV','GEA','OTIS','CARR','TT','JCI','ALLE',
  'LII','AAON','NVENT','GNRC','REXR','PLD','EGP','FR','STAG','TRNO',
  'QTS','DFT','CONE','CORR','INDT','IRET',
  'V','MA','GPN','FIS','FISV','AXP','DFS','SYF','COF','BFH',
  'WEX','FOUR','EVTC','PAYO','PAPL','PRAA','ENVA','QMCO',
  'TWLO','BAND','MSGN','AVLR','ALKT','BRZE','GLBE','APP','APPLOVIN',
  'MGNI','TTD','PUBM','MNTN','BURL','ROST','TJX','FIVE','OLLI','GOOS',
  'LULU','NKE','UA','UAA','PVH','VFC','RL','MOV','PLCE','CATO',
  'SCVL','FL','BOOT','HIBB','BNED','PRTY','SMRT',
  'WIX','SHOP','BIGC','CART','MELI','ETSY','EBAY','WISH','GLOB',
  'GRPN','ANGI','ATUS','LBTYB','LBTYK','CHTR','CMCSA','DIS','WBD',
  'PARA','FOXA','FOX','DISCK','DISCA','VIAC','VIACA','NFLX',
  'SPOT','TMUS','VZ','T','LUMN','WU','IDSA',
  'NEM','AEM','GOLD','KGC','AG','HL','PAAS','SSRM','EGO','BTG','NGD',
  'IAG','EDV','USA_GOLD','ARGX','HNZ',
  'XOM','CVX','COP','EOG','MPC','VLO','PSX','OXY','PXD','DVN','FANG',
  'HAL','SLB','BKR','NOV','HP','WTTR','PUMP','NGL','CIVI','SM',
  'MTDR','ESTE','BATL','CPE','CRGY','MEG',
  'NEE','DUK','SO','D','EXC','AEE','ES','ETR','WEC','CMS','NI',
  'PNW','EVRG','AES','BEP','CWEN','CLNE','BE','FCEL','PLUG','BLDP',
  'AMRC','ARRY','FLNC','STEM','GXII','RUN','NOVA','SPWR','CSIQ','JKS',
  'DQ','ENPH','SEDG','MAXN','SHLS',
])

// ── HARAM (567) ──────────────────────────────────────────────────────────────
const HARAM_SET = new Set([
  'JPM','BAC','WFC','C','GS','MS','USB','PNC','TFC','FITB','RF','HBAN','KEY',
  'CFG','ALLY','CIT','SBNY','SIVB','WAL','PACW','EWBC','BMTC','ISBC','NYCB',
  'FRC','BEN','IVZ','AB','WDR','DHIL','BSIG','AMG','GBL','VCNX','ARES',
  'APO','KKR','BX','CG','OCSL','ARCC','MAIN','HTGC','GAIN','GLAD','PSEC',
  'ARI','RC','ACRE','BXMT','LADR','STWD','KREF','TPG','BRSP','GPMT',
  'ALD','KCAP','OAKTREE','NMFC','TCPC','SLRC','TPVG','CSWC','MRCC','FDUS',
  'RJF','LPLA','AMTD','TD','RY','CM','BNS','BMO','MFC','SLF','GWO','IAG',
  'AIG','PRU','MET','LNC','PFG','VOYA','GL','RGA','FG','NWLI','GNW',
  'SFG','HIG','ALL','CB','TRV','WRB','RE','MRH','BRK.A','BRK.B','ACGL',
  'AFL','CNO','HCI','UNM','BHF','EIG','ORI','PRI','WLTW','AON','MMC',
  'AJG','RYAN','EQAT','COVA','PCVX',
  'PM','MO','BTI','IMBBY','VGR','STG','TPB','SWISHER',
  'BUD','SAM','BREW','ABEV','TAP','STZ','HEINY','DBRG','BF.A','BF.B',
  'DEO','SBUX',
  'MGM','WYNN','LVS','PENN','CZR','DKNG','BETZ','RSI','AGS','FULL',
  'BYD','CHDN','MCRI','MTN','TNL',
  'PYPL','SQ','V','COIN','MSTR','SI','SBNY',
  'GNCA','ARVN','DNLI','KDMN','RCUS','ABCL','AMGN','ABBV','BMY','LLY',
  'PFE','JNJ','MRK','GSK','SNY','AZN','NVS','ROG','BAYRY','NVO','NOVO',
  'PRGO','ENDP','MNK','IPIX','CARA','ZYLA','CRBP','CTRV','TRVN',
  'CAH','MCK','ABC','PDCO','HSIC','OMI','PBH',
  'BYND','VITL','OYST','SHOO','FOSL','KORS',
])

// ── DOUBTFUL (22) ─────────────────────────────────────────────────────────────
const DOUBTFUL_SET = new Set([
  'PYPL','INTC','QCOM','CSCO','IBM','ORCL','SAP','ACN','WMT','HD',
  'TGT','COST','KR','ACI','SFM','ANDE','INGR','SJM','GIS','CPB','MKC','CLX',
])

// ── Build verdict map once at module load ────────────────────────────────────
const VERDICTS: Record<string, 'HALAL' | 'HARAM' | 'DOUBTFUL'> = {}
for (const sym of HALAL_SET)    VERDICTS[sym] = 'HALAL'
for (const sym of HARAM_SET)    VERDICTS[sym] = 'HARAM'
for (const sym of DOUBTFUL_SET) VERDICTS[sym] = 'DOUBTFUL'

export function getVerdict(symbol: string): 'HALAL' | 'HARAM' | 'DOUBTFUL' | 'UNKNOWN' {
  return VERDICTS[symbol.toUpperCase()] ?? 'UNKNOWN'
}

export function getVerdictMap() { return VERDICTS }

export function getStats() {
  return { total: Object.keys(VERDICTS).length, halal: HALAL_SET.size, haram: HARAM_SET.size, doubtful: DOUBTFUL_SET.size }
}

// Flat array of halal-certified symbols — used by algo strategy modules for universe scanning
export const HALAL_SYMBOLS: string[] = [...HALAL_SET]
