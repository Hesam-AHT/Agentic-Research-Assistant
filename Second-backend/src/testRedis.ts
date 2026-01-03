import "dotenv/config";
import Redis from "ioredis";

async function main() {
  const r = new Redis(process.env.REDIS_URL!);
  console.log(await r.ping());
  await r.quit();
}

main().catch(console.error);
