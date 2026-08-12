import { QRCodeSVG } from "qrcode.react";

interface QrCodeSvgProps {
  value: string;
  size?: number;
}

/** Thin wrapper fixing our print defaults — plain SVG output, no wasted margin. */
export function QrCodeSvg({ value, size = 68 }: QrCodeSvgProps) {
  return <QRCodeSVG value={value} size={size} level="M" marginSize={0} />;
}
