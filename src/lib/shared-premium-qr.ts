import QRCode from "qrcode";
import { PDFDocument, rgb } from "pdf-lib";

import { getCanonicalAppUrl } from "./config";

const mmToPoints = 72 / 25.4;
export const QR_QUIET_MODULES = 4;
export const QR_MIN_MODULE_MM = 0.5;

export function buildSharedPremiumQrUrl(productId: string, code: string, origin = getCanonicalAppUrl()) {
  const url = new URL(`/en/unlock/${encodeURIComponent(productId)}`, origin);
  // Fragments are URL parameters processed in the browser, never HTTP request URLs.
  url.hash = new URLSearchParams({ productId, code }).toString();
  return url.toString();
}

export function createSharedPremiumQr(productId: string, code: string, origin = getCanonicalAppUrl()) {
  const payload = buildSharedPremiumQrUrl(productId, code, origin);
  const qr = QRCode.create(payload, { errorCorrectionLevel: "Q" });
  const gridSize = qr.modules.size + QR_QUIET_MODULES * 2;
  const qrSizeMm = Math.max(50, gridSize * QR_MIN_MODULE_MM);
  return { payload, modules: qr.modules, gridSize, qrSizeMm, widthMm: qrSizeMm, heightMm: qrSizeMm };
}

export function renderSharedPremiumQrSvg(productId: string, code: string, origin = getCanonicalAppUrl()) {
  const qr = createSharedPremiumQr(productId, code, origin);
  const unit = qr.qrSizeMm / qr.gridSize;
  const modules: string[] = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let col = 0; col < qr.modules.size; col += 1) {
      if (qr.modules.get(row, col)) {
        modules.push(`<rect x="${(col + QR_QUIET_MODULES) * unit}" y="${(row + QR_QUIET_MODULES) * unit}" width="${unit}" height="${unit}"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${qr.widthMm}mm" height="${qr.heightMm}mm" viewBox="0 0 ${qr.widthMm} ${qr.heightMm}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${modules.join("")}</g></svg>`;
}

export async function renderSharedPremiumQrPdf(productId: string, code: string, origin = getCanonicalAppUrl()) {
  const qr = createSharedPremiumQr(productId, code, origin);
  const doc = await PDFDocument.create();
  const page = doc.addPage([qr.widthMm * mmToPoints, qr.heightMm * mmToPoints]);
  page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(1, 1, 1) });
  const unit = qr.qrSizeMm / qr.gridSize * mmToPoints;
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let col = 0; col < qr.modules.size; col += 1) {
      if (qr.modules.get(row, col)) {
        page.drawRectangle({
          x: (col + QR_QUIET_MODULES) * unit,
          y: (qr.gridSize - row - QR_QUIET_MODULES - 1) * unit,
          width: unit, height: unit, color: rgb(0, 0, 0),
        });
      }
    }
  }
  doc.setTitle("Lamilia Lomi premium QR");
  doc.setSubject("Vector QR, Q error correction, four-module quiet zone. Print at 100% size.");
  return doc.save();
}
