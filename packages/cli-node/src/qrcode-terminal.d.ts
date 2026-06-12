declare module "qrcode-terminal" {
  interface QrOptions {
    small?: boolean;
  }
  const qrcode: {
    generate(text: string, opts: QrOptions, cb: (output: string) => void): void;
    generate(text: string, cb?: (output: string) => void): void;
    setErrorLevel(level: "L" | "M" | "Q" | "H"): void;
  };
  export default qrcode;
}
