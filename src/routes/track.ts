Paste this complete code into src/routes/track.ts:
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Configure Redis connection with SSL support and offline queue disabling to prevent hanging
const redisUrl = process.env.REDIS_URL;
const connection = redisUrl
  ? new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false, // Prevents hanging requests if Redis is offline
      connectTimeout: 5000,
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    })
  : new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 5000,
    });

export const conversionQueue = new Queue('conversion-queue', { connection });

interface TrackPayload {
  siteId: string;
  eventName: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
  email?: string;
  phone?: string;
  clientId?: string;
  sessionId?: string;
  url?: string;
  userAgent?: string;
  ip?: string;
}

// Utility: Normalize and SHA-256 Hash PII for Enhanced Conversions / CAPI
function hashPII(value?: string, type: 'email' | 'phone' = 'email'): string | undefined {
  if (!value) return undefined;
  let normalized = value.trim().toLowerCase();

  if (type === 'email') {
    const parts = normalized.split('@');
    if (parts.length === 2) {
      let [username, domain] = parts;
      if (domain === 'gmail.com' || domain === 'googlemail.com') {
        username = username.replace(/\./g, '');
      }
      normalized = `${username}@${domain}`;
    }
  } else if (type === 'phone') {
    normalized = normalized.replace(/\D/g, '');
    if (!normalized.startsWith('+') && normalized.length === 10) {
      normalized = `+1${normalized}`;
    }
  }

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export async function trackRoutes(fastify: FastifyInstance) {
  fastify.post('/api/v1/track', async (request: FastifyRequest<{ Body: TrackPayload }>, reply: FastifyReply) => {
    console.log('[Track Debug] Request received:', request.body);
    try {
      const {
        siteId,
        eventName,
        gclid,
        fbclid,
        msclkid,
        email,
        phone,
        clientId,
        sessionId,
      } = request.body || {};

      if (!siteId || !eventName) {
        return reply.status(400).send({ error: 'Missing required fields: siteId and eventName' });
      }

      // 1. Verify workspace exists in PostgreSQL
      console.log('[Track Debug] Step 1: Querying Prisma workspace...');
      const workspace = await prisma.workspace.findUnique({
        where: { siteId },
      });
      console.log('[Track Debug] Step 1 Success: Workspace ID =', workspace?.id || 'NOT FOUND');

      if (!workspace) {
        return reply.status(404).send({ error: 'Invalid siteId or workspace not found' });
      }

      // 2. Hash user PII
      const emailHash = hashPII(email, 'email');
      const phoneHash = hashPII(phone, 'phone');

      // 3. Generate unique event ID
      const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // 4. Store Conversion Event in PostgreSQL
      console.log('[Track Debug] Step 2: Creating ConversionEvent in Prisma...');
      const conversion = await prisma.conversionEvent.create({
        data: {
          workspaceId: workspace.id,
          eventId,
          eventName,
          gclid,
          fbclid,
          msclkid,
          emailHash,
          phoneHash,
          status: 'QUEUED',
        },
      });
      console.log('[Track Debug] Step 2 Success: Event ID =', conversion.eventId);

      // 5. Enqueue job into BullMQ
      console.log('[Track Debug] Step 3: Adding job to BullMQ Redis Queue...');
      await conversionQueue.add('dispatch-conversion', {
        conversionId: conversion.id,
        eventId: conversion.eventId,
        workspaceId: workspace.id,
        eventName,
        gclid,
        fbclid,
        msclkid,
        emailHash,
        phoneHash,
        clientId,
        sessionId,
      });
      console.log('[Track Debug] Step 3 Success: Enqueued into Redis!');

      fastify.log.info(`[Track] Conversion event logged & queued: ${eventId} (${eventName})`);

      return reply.status(200).send({
        success: true,
        eventId: conversion.eventId,
        status: conversion.status,
      });
    } catch (error: any) {
      console.error('[Track Fatal Error]:', error);
      fastify.log.error(`[Track Error]: ${error?.message || error}`);
      return reply.status(500).send({
        error: 'Internal Server Error processing tracking event',
        details: error?.message || String(error),
      });
    }
  });
}