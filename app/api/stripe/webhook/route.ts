import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { customers, invoices } from "@/db/schema";
import { isTestMode, stripe } from "@/lib/stripe";
import { refreshVisitPrices, syncInvoice } from "@/lib/stripe-invoices";
import { logError } from "@/lib/log";

// Stripe tells the app here when an invoice changes anywhere (the Stripe
// dashboard, the customer's invoice page, an automatic retry), so the app no
// longer needs the Sync button to notice. Set up in Stripe under Developers →
// Webhooks with this URL; its signing secret goes in STRIPE_WEBHOOK_SECRET.
//
// Every request must carry Stripe's signature for that secret; anything else
// is refused. The event's own copy of the invoice is never trusted: the app
// fetches the invoice from Stripe again, so repeated or out-of-order events
// can't leave it wrong. A failure answers 500 and Stripe retries later.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    // the raw body, exactly as sent: re-serialized JSON would fail the check
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  // live events never touch a test setup, and the other way round
  if (event.livemode === isTestMode()) return Response.json({ ignored: "other mode" });

  try {
    if (event.type === "invoice.deleted") {
      // only drafts can be deleted in Stripe
      const id = (event.data.object as Stripe.Invoice).id;
      if (id) {
        const gone = await db.delete(invoices).where(eq(invoices.stripeInvoiceId, id)).returning({ appointmentId: invoices.appointmentId });
        await refreshVisitPrices(gone.map((g) => g.appointmentId));
      }
    } else if (event.type.startsWith("invoice.")) {
      const id = (event.data.object as Stripe.Invoice).id;
      if (id) await syncInvoice(id);
    } else if (event.type === "customer.deleted") {
      // deleted in the Stripe dashboard: say so on the customer's page
      const id = (event.data.object as Stripe.Customer).id;
      await db
        .update(customers)
        .set({ stripeSyncError: `This customer (${id}) was deleted in Stripe. Link or create them again before invoicing.` })
        .where(eq(customers.stripeCustomerId, id));
    }
  } catch (err) {
    logError(`stripe webhook failed (${event.type})`, err);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
