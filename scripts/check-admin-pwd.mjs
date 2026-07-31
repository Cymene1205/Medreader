// Verify admin@local password and check role binding.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const admin = await db.user.findUnique({ where: { email: "admin@local" } });
  if (!admin) {
    console.log("admin@local not found");
    return;
  }
  console.log("admin row:", { id: admin.id, email: admin.email, role: admin.role, name: admin.name });

  const candidates = ["admin123456", "admin", "Admin@123", "Admin123456", "medreader"];
  for (const p of candidates) {
    const ok = await bcrypt.compare(p, admin.passwordHash);
    console.log(`  bcrypt.compare(${JSON.stringify(p)}) → ${ok}`);
  }
}

main().finally(() => db.$disconnect());
