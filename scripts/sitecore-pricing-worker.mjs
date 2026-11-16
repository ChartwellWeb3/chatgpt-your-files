// Retained to give existing deployments a clear cutover message.
console.error('The local pricing worker is retired. Deploy the sitecore-pricing Supabase Edge Function and recovery Cron. See infrastructure/performance/SITECORE-PRICING.md.');
process.exitCode = 1;