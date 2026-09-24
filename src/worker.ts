import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// GA4 Measurement Protocol Dispatcher
async function sendToGA4(event: any, measurementId?: string, apiSecret?: string) {
  if (!measurementId || !apiSecret) {
    console.log('[Worker] Skipping GA4 dispatch - missing Measurement ID or API Secret');
    return;
  }

  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`;

  const payload = {
    client_id: event.eventId,
    events: [
      {
        name: event.eventName,
        params: {
          gclid: event.gclid,
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

  console.log(`[Worker] GA4 Measurement Protocol event sent successfully for eventId: ${event.eventId}`);
}

async function processPendingConversions() {
  try {
    // 1. Fetch pending queued events from PostgreSQL
    const pendingEvents = await prisma.conversionEvent.findMany({
      where: { status: 'QUEUED' },
      take: 20,
    });

    if (pendingEvents.length === 0) {
      return;
    }

    console.log(`[Worker] Found ${pendingEvents.length} pending conversions in PostgreSQL queue...`);

    for (const event of pendingEvents) {
      try {
        // Mark as PROCESSING
        await prisma.conversionEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSING' },
        });

        // Dispatch to GA4 / ad channels
        const ga4MeasurementId = process.env.GA4_MEASUREMENT_ID;
        const ga4ApiSecret = process.env.GA4_API_SECRET;
        await sendToGA4(event, ga4MeasurementId, ga4ApiSecret);

        // Mark as DISPATCHED
        await prisma.conversionEvent.update({
          where: { id: event.id },
          data: { status: 'DISPATCHED' },
        });

        console.log(`[Worker] Successfully processed conversion event: ${event.eventId}`);
      } catch (err: any) {
        console.error(`[Worker] Failed to process conversion event ${event.eventId}:`, err.message);
        await prisma.conversionEvent.update({
          where: { id: event.id },
          data: { status: 'FAILED' },
        });
      }
    }
  } catch (error: any) {
    console.error('[Worker Loop Error]:', error.message);
  }
}

// Continuous polling loop running every 5 seconds
console.log('ClicktoTrack PostgreSQL Queue Worker active and polling...');
setInterval(processPendingConversions, 5000);