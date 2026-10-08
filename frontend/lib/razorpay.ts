import { api } from "./api";
import type { Credits } from "@/types/api";

/** Razorpay Standard Checkout: the server creates the order (its own price), Razorpay takes the payment in its own
 * window (UPI, cards, net banking; no card details ever touch this app), and the server verifies the signature. */

type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCtor = new (options: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: unknown) => void) => void };

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window !== "undefined" && (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("The payment window could not be loaded. Check your connection and try again."));
    };
    document.body.appendChild(s);
  });
  return loading;
}

export type PayResult = { status: "paid"; credits: Credits } | { status: "closed" } | { status: "failed"; message: string };

/** Pay for "plan:creator:monthly", "plan:pro:yearly", "topup:topup_30" ... Resolves when the window closes. */
export async function pay(item: string): Promise<PayResult> {
  const [order] = await Promise.all([api.createOrder(item), loadScript()]);
  const Razorpay = (window as unknown as { Razorpay: RazorpayCtor }).Razorpay;
  return new Promise<PayResult>((resolve) => {
    let settled = false;
    const done = (r: PayResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const rz = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: "Reel Maison",
      description: order.label,
      prefill: order.email ? { email: order.email } : undefined,
      theme: { color: "#C9A46A" },
      handler: async (r: RazorpayResponse) => {
        try {
          const credits = await api.verifyPayment({
            razorpayOrderId: r.razorpay_order_id,
            razorpayPaymentId: r.razorpay_payment_id,
            razorpaySignature: r.razorpay_signature,
          });
          done({ status: "paid", credits });
        } catch (e) {
          done({ status: "failed", message: e instanceof Error ? e.message : "The payment could not be verified." });
        }
      },
      modal: { ondismiss: () => done({ status: "closed" }) },
    });
    rz.on("payment.failed", (resp: unknown) => {
      const desc = (resp as { error?: { description?: string } })?.error?.description;
      done({ status: "failed", message: desc || "The payment did not go through. No money was taken." });
    });
    rz.open();
  });
}
