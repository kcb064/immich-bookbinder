import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

/** Local development convenience: load ./.env from the current directory when it exists. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file; rely on the real environment (Docker, CI)
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      console.error('\nSee apps/server/README.md for the list of environment variables.');
      process.exit(1);
    }
    throw err;
  }

  const app = await buildApp(config);

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        app.log.error(err, 'error during shutdown');
        process.exit(1);
      });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error(err, 'failed to start');
    process.exit(1);
  }
}

void main();
