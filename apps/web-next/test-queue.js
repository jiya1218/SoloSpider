import Redis from "ioredis";
import { Queue } from "bullmq";
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL;
console.log("Connecting to Redis:", redisUrl);

async function testQueue() {
  if (!redisUrl) {
    console.error("REDIS_URL is not set!");
    return;
  }

  const connection = new Redis(redisUrl);
  try {
    const queue = new Queue("prompt-scan", { connection });
    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();
    const delayed = await queue.getDelayed();

    console.log("--- prompt-scan Queue Stats ---");
    console.log("Waiting jobs count:", waiting.length);
    console.log("Active jobs count:", active.length);
    console.log("Completed jobs count:", completed.length);
    console.log("Failed jobs count:", failed.length);
    console.log("Delayed jobs count:", delayed.length);

    if (waiting.length > 0) {
      console.log("Waiting jobs:", waiting.map(j => ({ id: j.id, name: j.name, data: j.data })));
    }
    if (active.length > 0) {
      console.log("Active jobs:", active.map(j => ({ id: j.id, name: j.name, data: j.data })));
    }
    if (failed.length > 0) {
      console.log("Failed jobs:", failed.slice(0, 5).map(j => ({ id: j.id, name: j.name, failedReason: j.failedReason })));
    }
  } catch (err) {
    console.error("Error checking queue:", err);
  } finally {
    connection.disconnect();
  }
}

testQueue();
