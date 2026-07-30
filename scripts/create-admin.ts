/**
 * Standalone admin-creation script.
 *
 * Usage (with bun):
 *   bun run scripts/create-admin.ts
 *   ADMIN_EMAIL=root@local ADMIN_PASSWORD=supersecret bun run scripts/create-admin.ts
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD from env (with sensible fallbacks),
 * hashes the password with bcrypt, and upserts a User row with role="admin".
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@local")
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "admin123456";

  if (!email || !password) {
    console.error("Missing ADMIN_EMAIL or ADMIN_PASSWORD");
    process.exit(1);
  }
  if (password.length < 8) {
    console.warn(
      "[create-admin] WARNING: password is shorter than 8 characters."
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await db.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: "admin",
    },
    create: {
      email,
      name: "Administrator",
      passwordHash,
      role: "admin",
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  });

  console.log("✅ Admin user ready:");
  console.log(`   id    : ${user.id}`);
  console.log(`   email : ${user.email}`);
  console.log(`   name  : ${user.name ?? "(none)"}`);
  console.log(`   role  : ${user.role}`);
}

main()
  .catch((e) => {
    console.error("[create-admin] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
