import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const envFilePath = resolve(process.cwd(), '.env');
if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? '127.0.0.1');
}
await bootstrap();
