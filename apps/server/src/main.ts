import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { GitMissingError } from './git.js';

const config = loadConfig();

try {
  const { app } = await buildApp(config, { logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
  await app.listen({ host: config.host, port: config.port });
  console.log(`API listening on http://${config.host}:${config.port}`);
  console.log(`Library store: ${config.libraryDir}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
} catch (err) {
  if (err instanceof GitMissingError) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
}
