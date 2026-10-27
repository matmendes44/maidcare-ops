import "server-only";

import { headers } from "next/headers";
import QRCode from "qrcode";

// The site's own address, from the request, for links printed on labels.
export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// The QR codes cleaners scan to report a problem (app/r): one per location,
// one per piece of equipment. The token in the link is the only key.
export const locationReportPath = (token: string) => `/r/${token}`;
export const assetReportPath = (token: string) => `/r/equipment/${token}`;

export function qrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
