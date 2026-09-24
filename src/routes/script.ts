import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';

export async function scriptRoutes(fastify: FastifyInstance) {
  fastify.get('/clicktotrack.js', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const scriptPath = path.join(__dirname, '../../public/clicktotrack.js');

      if (!fs.existsSync(scriptPath)) {
        return reply.status(404).send('/* Script file not found */');
      }

      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      return reply
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=86400, s-maxage=604800')
        .send(scriptContent);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send('/* Error serving tracking script */');
    }
  });
}