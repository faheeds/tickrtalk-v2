/** @type {import('next').NextConfig} */
const {withWorkflow}=require('workflow/next')
module.exports = withWorkflow({
 reactStrictMode: true,
 distDir: process.env.NEXT_BUILD_DIR || '.next',
 devIndicators: false,
 experimental: { optimizePackageImports: ['@phosphor-icons/react'] },
 outputFileTracingIncludes:{'/api/paper':['./services/paper/data/sp500.json'],'/api/owner/backtests':['./services/vibe-backtest/*','./services/paper/data/sp500.json'],'/.well-known/workflow/**':['./services/paper/data/sp500.json','./services/research/runner.py','./services/research/reports.py','./services/research/requirements.lock.txt','./services/research/cloud_boot.py','./services/research/vendor/*','./services/vibe-backtest/*']},
})
