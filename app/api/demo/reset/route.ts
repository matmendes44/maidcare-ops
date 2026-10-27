import { isDemo } from "@/lib/demo";
import { resetDemoData } from "@/lib/demo-seed";
import { logError } from "@/lib/log";

// Rebuilds the demo's data every night (vercel.json), so whatever visitors
// changed is gone and the dates stay current. Vercel Cron sends CRON_SECRET.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isDemo()) return new Response("Not found", { status: 404 });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json(await resetDemoData());
  } catch (err) {
    logError("demo reset failed", err);
    return new Response("Reset failed", { status: 500 });
  }
}
