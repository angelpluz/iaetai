import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseCount(raw) {
  const parsed = Number(raw ?? "100");
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(Math.floor(parsed), 5000);
}

function createKey() {
  const seed = randomBytes(8).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = seed.slice(0, 10).padEnd(10, "X");
  return `ALPHA-${body.slice(0, 5)}-${body.slice(5, 10)}`;
}

async function main() {
  const count = parseCount(process.argv[2]);
  const created = [];
  const seen = new Set();

  while (created.length < count) {
    const code = createKey();
    if (seen.has(code)) continue;
    seen.add(code);

    const existing = await prisma.alphaWhitelistKey.findUnique({
      where: { code },
      select: { code: true },
    });
    if (existing) continue;

    await prisma.alphaWhitelistKey.create({
      data: { code },
    });
    created.push(code);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = resolve(process.cwd(), `alpha-whitelist-keys-${stamp}.txt`);
  writeFileSync(outputPath, created.join("\n") + "\n", "utf8");

  console.log(`Generated ${created.length} keys`);
  console.log(`Saved to: ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
