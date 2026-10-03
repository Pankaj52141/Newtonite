import { PrismaClient } from '@prisma/client';

/**
 * Singleton PrismaClient with connection pooling.
 * Prisma uses a connection pool by default (pool_size based on `connection_limit` in DATABASE_URL
 * or defaults to `num_cpus * 2 + 1`). This is sufficient for our scale.
 */
const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

export default prisma;
