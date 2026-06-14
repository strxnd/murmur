/// <reference types="vite/client" />

import type { MurmurApi } from "../../preload";

declare module "next/dist/compiled/@next/font" {
  export interface NextFont {
    className: string;
    style: {
      fontFamily: string;
      fontWeight?: number;
      fontStyle?: string;
    };
  }

  export interface NextFontWithVariable extends NextFont {
    variable: string;
  }
}

declare global {
  interface Window {
    murmur: MurmurApi;
  }
}
