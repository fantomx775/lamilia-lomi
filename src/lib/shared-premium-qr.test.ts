import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import QRCode from "qrcode";
import { buildSharedPremiumQrUrl, createSharedPremiumQr, QR_MIN_MODULE_MM, QR_QUIET_MODULES, renderSharedPremiumQrPdf, renderSharedPremiumQrSvg } from "./shared-premium-qr";

const productId = "11111111-1111-4111-8111-111111111111";
const code = "KDP-0123456789ABCDEF0123456789ABCDEF";
const origin = new URL("https://lamilialomi.com");

describe("KDP shared premium print exports", () => {
  it("binds the QR to the product UUID and keeps the code out of HTTP paths and queries", () => {
    const url = new URL(buildSharedPremiumQrUrl(productId, code, origin));
    expect(url.origin).toBe(origin.origin);
    expect(url.pathname).toBe(`/en/unlock/${productId}`);
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("code")).toBe(code);
    expect(new URLSearchParams(url.hash.slice(1)).get("productId")).toBe(productId);
    expect(url.pathname + url.search).not.toContain(code);
  });

  it("encodes Q error correction and includes a full four-module quiet zone at print size", () => {
    const qr = createSharedPremiumQr(productId, code, origin);
    const expected = QRCode.create(qr.payload, { errorCorrectionLevel: "Q" });
    expect(qr.modules.data).toEqual(expected.modules.data);
    expect(QR_QUIET_MODULES).toBe(4);
    expect(qr.gridSize).toBe(qr.modules.size + 8);
    expect(qr.qrSizeMm).toBeGreaterThanOrEqual(50);
    expect(qr.qrSizeMm / qr.gridSize).toBeGreaterThanOrEqual(QR_MIN_MODULE_MM);
    const svg = renderSharedPremiumQrSvg(productId, code, origin);
    expect(svg).toContain(`width="${qr.widthMm}mm"`);
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('fill="#000"');
    expect(svg).toContain(code);
    expect(svg).not.toContain("<image");
  });

  it("escapes manually entered text in SVG instead of creating executable markup", () => {
    const svg = renderSharedPremiumQrSvg(productId, '<script>alert("x")</script>', origin);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("exports a one-page vector PDF with the same physical dimensions and readable code", async () => {
    const bytes = await renderSharedPremiumQrPdf(productId, code, origin);
    const pdf = await PDFDocument.load(bytes);
    const qr = createSharedPremiumQr(productId, code, origin);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(qr.widthMm * 72 / 25.4);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(qr.heightMm * 72 / 25.4);
    expect(pdf.getSubject()).toContain("four-module quiet zone");
    expect(pdf.getPage(0).node.Resources()?.lookup(PDFName.of("Font"), PDFDict).keys()).toEqual([]);
  });
});
