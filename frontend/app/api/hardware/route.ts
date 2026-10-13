import { route } from "@/server/core/http";
import { availableEncoders, ENCODER_LABELS, pickEncoder } from "@/server/video/render/parts";

/** Video encoders that really work on this machine, and the one in use. */
export const GET = route(async () => {
  const encoders = await availableEncoders(), chosen = await pickEncoder();
  return { encoders: encoders.map((e) => ({ id: e, name: ENCODER_LABELS[e] ?? e })), selected: chosen, selectedName: ENCODER_LABELS[chosen] ?? chosen };
});
