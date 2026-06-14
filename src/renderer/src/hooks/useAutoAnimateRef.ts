import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { AutoAnimateOptions } from "@formkit/auto-animate";
import type { RefCallback } from "react";

const autoAnimateOptions = {
  duration: 180,
  easing: "cubic-bezier(0.2, 0, 0, 1)"
} satisfies Partial<AutoAnimateOptions>;

export function useAutoAnimateRef<T extends Element>(): RefCallback<T> {
  const [parent] = useAutoAnimate<T>(autoAnimateOptions);
  return parent;
}
