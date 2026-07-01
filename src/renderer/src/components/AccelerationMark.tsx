import type { JSX } from "react";
import type { SttRuntimeAccelerator } from "../../../shared/types";

export type BrandAccelerator = Extract<SttRuntimeAccelerator, "apple" | "cuda">;

const nvidiaLogoPath = [
  "M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035",
  "m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063z",
  "m0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11",
  "M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z"
].join(" ");

const appleLogoPath =
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

export function AccelerationMark({ accelerators }: { accelerators: BrandAccelerator[] }): JSX.Element {
  const hasApple = accelerators.includes("apple");
  const hasCuda = accelerators.includes("cuda");

  if (hasApple && hasCuda) {
    return (
      <span className="flex items-center gap-0.5">
        <AppleMark className="h-4 w-4" />
        <NvidiaMark className="h-4 w-4" />
      </span>
    );
  }

  return <AcceleratorMark accelerator={hasApple ? "apple" : "cuda"} className="h-5 w-5" />;
}

export function AcceleratorMark({ accelerator, className }: { accelerator: BrandAccelerator; className?: string }): JSX.Element {
  return accelerator === "apple" ? <AppleMark className={className} /> : <NvidiaMark className={className} />;
}

function AppleMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d={appleLogoPath} />
    </svg>
  );
}

function NvidiaMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d={nvidiaLogoPath} />
    </svg>
  );
}
