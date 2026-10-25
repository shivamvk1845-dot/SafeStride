import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

async function main() {
  const email = "demo@safestride.example";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Demo Traveler", passwordHash: await bcrypt.hash("SafeStrideDemo2026!", 12) },
  });
  await prisma.trustedContact.upsert({
    where: { ownerId_email: { ownerId: user.id, email: "guardian@safestride.example" } },
    update: {},
    create: { ownerId: user.id, email: "guardian@safestride.example", name: "Demo Guardian" },
  });
  console.info("Demo account ready: demo@safestride.example / SafeStrideDemo2026!");
}

main().finally(() => prisma.$disconnect());
