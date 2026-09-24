import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

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
      // Strip period dots from Gmail usernames before domain
      if (domain === 'gmail.com' || domain === 'googlemail.com') {
        username = username.replace(/\./g, '');
      }
      normalized = `${username}@${domain}`;
    }
  } else if (type === 'phone') {
    // Strip non-digits and ensure + E.164 prefix
    normalized = normalized.replace(/\D/g, '');
    if (!normalized.startsWith('+') && normalized.length === 10) {
      normalized = `+1${normalized}`;
    }
  }

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export async function trackRoutes(fastify: FastifyInstance) {
  fastify.post('/api/v1/track', async (request: FastifyRequest<{ Body: TrackPayload }>, reply: FastifyReply) => {
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
        url,
      } = request.body;

      if (!siteId || !eventName) {
        return reply.status(400).send({ error: 'Missing required fields: siteId and eventName' });
      }

      // 1. Verify workspace exists
      const workspace = await prisma.workspace.findUnique({
        where: { siteId },
      });

      if (!workspace) {
        return reply.status(404).send({ error: 'Invalid siteId or workspace not found' });
      }

      // 2. Hash user PII for Enhanced Conversions / Advanced Matching
      const emailHash = hashPII(email, 'email');
      const phoneHash = hashPII(phone, 'phone');

      // 3. Generate unique event ID
      const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // 4. Store Conversion Event in PostgreSQL
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

      fastify.log.info(`[Track] Conversion event logged: ${eventId} (${eventName}) for Workspace: ${workspace.id}`);

      return reply.status(200).send({
        success: true,
        eventId: conversion.eventId,
        status: conversion.status,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error processing tracking event' });
    }
  });
}