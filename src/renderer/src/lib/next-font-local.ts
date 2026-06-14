interface LocalFontOptions {
  variable?: string;
}

interface LocalFontResult {
  className: string;
  variable: string;
  style: {
    fontFamily: string;
  };
}

export default function localFont(options: LocalFontOptions): LocalFontResult {
  const variableName = options.variable?.replace(/^--/, "") || "font-local";

  return {
    className: variableName,
    variable: variableName,
    style: {
      fontFamily: `var(--${variableName})`
    }
  };
}
