import { z } from "zod";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { verifyPayment } from "../../../../server/credits";

const camel = (v: unknown) => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), x])) : v);
export const POST = route(async (req) => {
  const p = await body(req, z.preprocess(camel, z.object({ razorpayOrderId: z.string().max(60), razorpayPaymentId: z.string().max(60), razorpaySignature: z.string().max(200) })));
  return verifyPayment(p.razorpayOrderId, p.razorpayPaymentId, p.razorpaySignature);
});
