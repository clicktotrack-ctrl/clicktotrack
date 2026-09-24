import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding ClicktoTrack database...');

  // Create default demo Organization
  const org = await prisma.organization.upsert({
    where: { id: 'demo-org-id' },
    update: {},
    create: {
      id: 'demo-org-id',
      name: 'Demo Agency Organization',
    },
  });

  // Create default Workspace with test siteId
  const workspace = await prisma.workspace.upsert({
    where: { domain: 'example.com' },
    update: {
      siteId: 'demo-site-123',
    },
    create: {
      orgId: org.id,
      domain: 'example.com',
      siteId: 'demo-site-123',
    },
  });

  console.log('Database seeded successfully!');
  console.log(`Demo Workspace Domain: ${workspace.domain}`);
  console.log(`Test siteId: ${workspace.siteId}`);
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });