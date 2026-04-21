/**
 * Persistent Job Queue using BullMQ + Redis
 *
 * Jobs are processed one at a time (concurrency: 1).
 * When a job finishes, the next queued job auto-starts.
 * Jobs survive server restarts because they're stored in Redis.
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const { Job } = require('./database');
const { processImportJob } = require('./importEngine');
const { processExportJob } = require('./exportEngine');
const logger = require('../utils/logger');

// Redis connection config — supports Railway's REDIS_URL or individual vars
let connection;
if (process.env.REDIS_URL) {
  const url = new URL(process.env.REDIS_URL);
  connection = {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    maxRetriesPerRequest: null,
  };
} else {
  connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
  };
}

// Create the queue
const importExportQueue = new Queue('ultra-matrix-jobs', {
  connection,
  defaultJobOptions: {
    attempts: 1, // Don't auto-retry (we handle errors in the processor)
    removeOnComplete: { count: 100 }, // Keep last 100 completed
    removeOnFail: { count: 200 }, // Keep last 200 failed
  },
});

// Track active cancellations
const cancelledJobs = new Set();

/**
 * Add a job to the queue
 */
async function enqueueJob(jobRecord) {
  // Update DB status to queued
  await Job.update(jobRecord.id, { status: 'queued' });

  // Add to BullMQ
  await importExportQueue.add(
    jobRecord.type, // 'import' or 'export'
    {
      jobId: jobRecord.id,
      shopId: jobRecord.shopId,
      type: jobRecord.type,
      resourceType: jobRecord.resourceType,
      filePath: jobRecord.filePath,
      fileName: jobRecord.fileName,
    },
    {
      jobId: jobRecord.id, // Use our DB job ID as the Bull job ID
    }
  );

  logger.info(`Job ${jobRecord.id} enqueued (${jobRecord.type} ${jobRecord.resourceType})`);
  return jobRecord;
}

/**
 * Request cancellation of a running job
 */
function cancelJob(jobId) {
  cancelledJobs.add(jobId);
  logger.info(`Cancellation requested for job ${jobId}`);
  return true;
}

/**
 * Check if a job has been cancelled
 */
function isJobCancelled(jobId) {
  return cancelledJobs.has(jobId);
}

/**
 * Initialize the worker that processes jobs
 * Called once on server start
 */
function startWorker() {
  const worker = new Worker(
    'ultra-matrix-jobs',
    async (bullJob) => {
      const { jobId, type } = bullJob.data;
      logger.info(`Worker picked up job ${jobId} (${type})`);

      try {
        // Get fresh job data from DB (includes shop info)
        const jobRecord = await Job.findById(jobId);
        if (!jobRecord) {
          throw new Error(`Job ${jobId} not found in database`);
        }

        // Get shop for access token
        const { Shop } = require('./database');
        const shop = await Shop.findById(jobRecord.shopId);
        if (!shop) {
          throw new Error(`Shop not found for job ${jobId}`);
        }

        // Update status to processing
        await Job.update(jobId, {
          status: 'processing',
          startedAt: new Date().toISOString(),
        });

        // Process based on type
        if (type === 'import') {
          await processImportJob({
            jobId,
            shopDomain: shop.shopDomain,
            accessToken: shop.accessToken,
            filePath: jobRecord.filePath,
            resourceType: jobRecord.resourceType,
            isCancelled: () => isJobCancelled(jobId),
          });
        } else if (type === 'export') {
          await processExportJob({
            jobId,
            shopDomain: shop.shopDomain,
            accessToken: shop.accessToken,
            resourceType: jobRecord.resourceType,
            isCancelled: () => isJobCancelled(jobId),
          });
        } else {
          throw new Error(`Unknown job type: ${type}`);
        }
      } catch (err) {
        logger.error(`Job ${jobId} failed:`, err);
        await Job.update(jobId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          errors: JSON.stringify([err.message]),
        }).catch(e => logger.error('Failed to update job status:', e));
      } finally {
        cancelledJobs.delete(jobId);
      }
    },
    {
      connection,
      concurrency: 1, // Process ONE job at a time
      limiter: {
        max: 1,
        duration: 1000, // Extra safety: max 1 job per second
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info(`Job ${job.data.jobId} completed via queue`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.data?.jobId || 'unknown'} failed in queue:`, err.message);
  });

  worker.on('error', (err) => {
    logger.error('Worker error:', err);
  });

  logger.info('Job queue worker started (concurrency: 1)');
  return worker;
}

/**
 * Get queue stats
 */
async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    importExportQueue.getWaitingCount(),
    importExportQueue.getActiveCount(),
    importExportQueue.getCompletedCount(),
    importExportQueue.getFailedCount(),
    importExportQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  logger.info('Shutting down job queue...');
  await importExportQueue.close();
}

module.exports = {
  importExportQueue,
  enqueueJob,
  cancelJob,
  isJobCancelled,
  startWorker,
  getQueueStats,
  shutdown,
};
