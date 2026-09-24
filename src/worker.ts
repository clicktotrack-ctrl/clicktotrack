import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

// Configure Redis connection for BullMQ
const redisUrl = process.env.REDIS_URL;
const connection = redisUrl
  ? new Redis(redisUrl, { maxRetriesPerRequest: null, tls: redisUrl.startsWith('rediss://') ? {} : undefined })
  : new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null,
    });

interface ConversionJobData {
  conversionId: string;
  eventId: string;
  workspaceId: string;
  eventName: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
  emailHash?: string;
  phoneHash?: string;
  clientId?: string;
  sessionId?: string;
}

// GA4 Measurement Protocol Dispatcher
async function sendToGA4(data: ConversionJobData, measurementId?: string, apiSecret?: string) {
  if (!measurementId || !apiSecret) {
    console.log('[Worker] Skipping GA4 dispatch - missing Measurement ID or API Secret');
    return;
  }

  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`;

  const payload = {
    client_id: data.clientId || data.eventId,
    events: [
      {
        name: data.eventName,
        params: {
          session_id: data.sessionId,
          gclid: data.gclid,
          engagement_time_msec: '100',
        },
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`GA4 MP dispatch failed with status ${response.status}`);
  }

  console.log(`[Worker] GA4 Measurement Protocol event sent successfully for eventId: ${data.eventId}`);
}

// Main BullMQ Worker Processor
const worker = new Worker<ConversionJobData>(
  'conversion-queue',
  async (job: Job<ConversionJobData>) => {
    console.log(`[Worker] Processing job ${job.id} for Event ID: ${job.data.eventId}`);

    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: job.data.workspaceId },
      });

      if (!workspace) {
        throw new Error(`Workspace ${job.data.workspaceId} not found`);
      }

      // Dispatch to GA4 Measurement Protocol
      const ga4MeasurementId = process.env.GA4_MEASUREMENT_ID;
      const ga4ApiSecret = process.env.GA4_API_SECRET;
      await sendToGA4(job.data, ga4MeasurementId, ga4ApiSecret);

      // Mark Conversion Event as DISPATCHED in PostgreSQL
      await prisma.conversionEvent.update({
        where: { id: job.data.conversionId },
        data: { status: 'DISPATCHED' },
      });

      console.log(`[Worker] Job ${job.id} completed successfully!`);
    } catch (error) {
      console.error(`[Worker] Job ${job.id} failed:`, error);

      await prisma.conversionEvent.update({
        where: { id: job.data.conversionId },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  },
  { connection }
);

worker.on('completed', (job) => {
  console.log(`[Worker] Queue Job ${job.id} has completed.`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Queue Job ${job?.id} failed with error: ${err.message}`);
});

console.log('ClicktoTrack S2S Dispatcher Worker active and listening to conversion-queue...');