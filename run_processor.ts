import { processHubSpotJobs } from './integrations/hubspot/hubspot.processor.js';
async function run() {
  console.log("Running HubSpot jobs...");
  await processHubSpotJobs(10);
  console.log("Finished running HubSpot jobs.");
  process.exit(0);
}
run();
