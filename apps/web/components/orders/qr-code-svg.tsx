import { QRCodeSVG } from "qrcode.react";

interface QrCodeSvgProps {
  value: string;
  size?: number;
}

/** Thin wrapper fixing our print defaults — plain SVG output, real quiet zone baked in.
 *
 * `marginSize={0}` here used to strip the QR's quiet zone entirely — the blank border every QR
 * needs around it so a scanner's finder-pattern detection isn't confused by whatever sits right
 * next to the code (here, the address text in the same flex row, gap-2 apart at most). That's the
 * same lesson BarcodeSvg already learned for barcodes (see its own comment: "a scanner needs real
 * whitespace... baked into the image itself — CSS padding on a wrapper isn't the same thing") —
 * this component just hadn't been given the equivalent fix. `marginSize={4}` matches the ISO/IEC
 * 18004 spec's recommended 4-module quiet zone rather than a smaller compromise, since on a small,
 * possibly slightly-blurred thermal print, scan reliability matters far more than the few extra mm
 * saved by shaving the margin down. */
export function QrCodeSvg({ value, size = 68 }: QrCodeSvgProps) {
  return <QRCodeSVG value={value} size={size} level="M" marginSize={4} />;
}
