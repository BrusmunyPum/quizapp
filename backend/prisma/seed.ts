import { PrismaClient } from '@prisma/client';
import { loadEnvFileOnce } from '../src/config/env';
import { seedStarterQuizzesIfEmpty } from '../src/quizzes/starter-quizzes';

async function main() {
  loadEnvFileOnce();
  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    const seeded = await seedStarterQuizzesIfEmpty(prisma);
    console.log(
      seeded
        ? 'Seeded starter quizzes into PostgreSQL.'
        : 'Database already contains quizzes; skipping starter seed.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
