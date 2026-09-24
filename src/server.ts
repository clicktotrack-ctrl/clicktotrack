import Fastify from 'fastify';
import cors from '@fastify/cors';
import { trackRoutes } from './routes/track';

const server = Fastify({
  logger: true,
});

// Register CORS
server.register(cors, {
  origin: '*',
});

// Register Tracking API Routes
server.register(trackRoutes);

// Health check endpoint for DigitalOcean readiness probes
server.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Root endpoint
server.get('/', async (request, reply) => {
  return { message: 'ClicktoTrack API Engine Running' };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    // CRITICAL: Bind to 0.0.0.0 for DigitalOcean container network interface
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on http://0.0.0.0:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();