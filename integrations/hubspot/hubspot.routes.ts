import { Router } from 'express';
import { getHubSpotStatus, retryDeadLetterJob } from './hubspot.controller.js';
import { processHubSpotJobs } from './hubspot.processor.js';

const router = Router();

router.get('/status', getHubSpotStatus);

router.post('/jobs/:id/retry', async (req, res) => {
  // We expect this to be protected by standard CPS auth later or specifically authorized.
  // For now, it delegates to controller.
  await retryDeadLetterJob(req, res);
});

router.get('/cron/sync', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const count = await processHubSpotJobs();
    res.json({ success: true, processed: count });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
