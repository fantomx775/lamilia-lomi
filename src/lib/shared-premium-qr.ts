import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import * as opentype from "opentype.js";
import type { Font } from "opentype.js";

import { getCanonicalAppUrl } from "./config";

const mmToPoints = 72 / 25.4;
export const QR_QUIET_MODULES = 4;
export const QR_MIN_MODULE_MM = 0.5;
let printFont: Font | undefined;

function getPrintFont() {
  if (!printFont) {
    const bytes = new Uint8Array(readFileSync(join(process.cwd(), "src/lib/fonts/NotoSansMono-Regular.ttf")));
    printFont = opentype.parse(bytes.buffer);
  }
  return printFont;
}

// Print labels use ASCII text; direct glyph layout avoids browser shaping and
// keeps the same deterministic outlines in PDF and SVG.
function textWidth(font: Font, value: string, size: number) {
  return [...value].reduce((width, char) => width + (font.charToGlyph(char).advanceWidth ?? font.unitsPerEm) * size / font.unitsPerEm, 0);
}

function textOutline(font: Font, value: string, x: number, baseline: number, size: number) {
  const path = new opentype.Path();
  let cursor = x;
  for (const char of value) {
    const glyph = font.charToGlyph(char);
    path.extend(glyph.getPath(cursor, baseline, size));
    cursor += (glyph.advanceWidth ?? font.unitsPerEm) * size / font.unitsPerEm;
  }
  return path.commands.map((command) => {
    switch (command.type) {
      case "M": case "L": return `${command.type} ${command.x} ${command.y}`;
      case "Q": return `Q ${command.x1} ${command.y1} ${command.x} ${command.y}`;
      case "C": return `C ${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
      case "Z": return "Z";
    }
  }).join(" ");
}

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
  const widthMm = Math.max(qrSizeMm + 20, textWidth(getPrintFont(), code, 7) / mmToPoints + 12);
  return { payload, modules: qr.modules, gridSize, qrSizeMm, widthMm, heightMm: qrSizeMm + 32 };
}

export function renderSharedPremiumQrSvg(productId: string, code: string, origin = getCanonicalAppUrl()) {
  const qr = createSharedPremiumQr(productId, code, origin);
  const unit = qr.qrSizeMm / qr.gridSize;
  const modules: string[] = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let col = 0; col < qr.modules.size; col += 1) {
      if (qr.modules.get(row, col)) {
        modules.push(`<rect x="${(qr.widthMm - qr.qrSizeMm) / 2 + (col + QR_QUIET_MODULES) * unit}" y="${8 + (row + QR_QUIET_MODULES) * unit}" width="${unit}" height="${unit}"/>`);
      }
    }
  }
  const font = getPrintFont();
  const codeSize = Math.max(7 / mmToPoints, Math.min(2.8, (qr.widthMm - 12) / textWidth(font, code, 1)));
  const label = "Scan for premium materials";
  const labelSize = 10 / mmToPoints;
  const labelPath = textOutline(font, label, (qr.widthMm - textWidth(font, label, labelSize)) / 2, qr.qrSizeMm + 22, labelSize);
  const codePath = textOutline(font, code, (qr.widthMm - textWidth(font, code, codeSize)) / 2, qr.qrSizeMm + 28, codeSize);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${qr.widthMm}mm" height="${qr.heightMm}mm" viewBox="0 0 ${qr.widthMm} ${qr.heightMm}" role="img" aria-label="Premium access QR. Manual code: ${escapeXml(code)}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${modules.join("")}</g><g fill="#000"><path d="${labelPath}"/><path d="${codePath}"/></g></svg>`;
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
          x: (qr.widthMm - qr.qrSizeMm) / 2 * mmToPoints + (col + QR_QUIET_MODULES) * unit,
          y: page.getHeight() - 8 * mmToPoints - (row + QR_QUIET_MODULES + 1) * unit,
          width: unit, height: unit, color: rgb(0, 0, 0),
        });
      }
    }
  }
  const font = getPrintFont();
  const label = "Scan for premium materials";
  const labelSize = 10;
  const codeSize = Math.max(7, Math.min(9, (page.getWidth() - 12 * mmToPoints) / textWidth(font, code, 1)));
  const labelPath = textOutline(font, label, (page.getWidth() - textWidth(font, label, labelSize)) / 2, page.getHeight() - 10 * mmToPoints, labelSize);
  const codePath = textOutline(font, code, (page.getWidth() - textWidth(font, code, codeSize)) / 2, page.getHeight() - 4 * mmToPoints, codeSize);
  page.drawSvgPath(labelPath, { x: 0, y: page.getHeight(), color: rgb(0, 0, 0) });
  page.drawSvgPath(codePath, { x: 0, y: page.getHeight(), color: rgb(0, 0, 0) });
  doc.setTitle("Lamilia Lomi - premium access print label");
  doc.setSubject("Vector QR, Q error correction, four-module quiet zone. Print at 100% size.");
  return doc.save();
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}
