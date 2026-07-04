import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { KillRequest } from '@als/shared';
import { detectServers } from './detect.js';
import { killByPid, killByPort } from './kill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4711);
const HOST = '127.0.0.1';
const SELF_PID = process.pid;

const webDistPath = path.resolve(__dirname, '../../web/dist');

export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });

  app.get('/api/health', async () => ({
    status: 'ok' as const,
    pid: SELF_PID,
    port: PORT,
  }));

  app.get('/api/servers', async () => {
    const servers = await detectServers(SELF_PID, PORT);
    return { servers };
  });

  app.post<{ Body: KillRequest }>('/api/kill', async (request, reply) => {
    const body = request.body;

    if (!body || (body.pid === undefined && body.port === undefined)) {
      return reply.status(400).send({
        success: false,
        message: 'Request body must include either pid or port.',
      });
    }

    if (body.pid !== undefined && body.port !== undefined) {
      return reply.status(400).send({
        success: false,
        message: 'Provide only one of pid or port, not both.',
      });
    }

    const result =
      body.pid !== undefined ? await killByPid(body.pid, SELF_PID) : await killByPort(body.port!, SELF_PID);

    if (!result.success) {
      return reply.status(result.statusCode ?? 500).send({
        success: false,
        message: result.message,
      });
    }

    return {
      success: true,
      message: result.message,
    };
  });

  return app;
}

export async function registerStatic(app: Awaited<ReturnType<typeof buildApp>>) {
  const fs = await import('node:fs/promises');
  try {
    await fs.access(webDistPath);
  } catch {
    return;
  }

  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }

    return reply.sendFile('index.html');
  });
}

async function main() {
  const app = await buildApp();
  await registerStatic(app);

  await app.listen({ port: PORT, host: HOST });
  console.log(`Active Local Servers running at http://${HOST}:${PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
