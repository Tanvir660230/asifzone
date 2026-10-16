import { deflateSync } from "node:zlib";
import fixtures from "./label-orders.json";

/** A store logo for the print spec, shaped like Asif Zone's: a black square with a white mark in it (240×240 RGB).
 * Built here so the spec needs no binary asset. */
export function makeLogoPng(): Buffer {
  const size = 240;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const mark = x > 60 && x < 180 && y > 90 && y < 150; // the white block inside the black square
      const v = mark ? 255 : 0;
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Hard real-world label cases (Steadfast's own sample, a very long Bangla address + 6 items + a long courier note, a
 * 12-item unbooked order, a short paid order) shaped as the `/api/orders/bulk/get` response the print-labels page reads.
 * The print spec serves these through page.route, so it exercises the real page and capture pipeline without
 * touching any database. */
export type LabelFixtureKey = (typeof fixtures)[number]["key"];

export function buildLabelOrders() {
  return fixtures.map((f, index) => {
    const id = `label-fixture-${f.key}`;
    const orderNumber = `ORD-20261016-${String(index + 1).padStart(2, "0")}${f.key.slice(0, 4).toUpperCase()}`;
    const consignment = f.booked ? String(309342432 + index) : null;
    const items = f.items.map(([name, size, color, quantity], i) => ({
      id: `${id}-item-${i}`,
      orderId: id,
      productId: `p-${i}`,
      variantId: `v-${i}`,
      productNameSnapshot: name,
      sizeSnapshot: size,
      colorSnapshot: color,
      skuSnapshot: `SKU-${i}`,
      quantity,
      unitPrice: "100.00",
      lineTotal: "100.00",
    }));
    return {
      id,
      orderNumber,
      customerId: null,
      status: "PACKED",
      paymentMethod: (f as { paymentMethod?: string }).paymentMethod ?? "COD",
      paymentStatus: (f as { paymentStatus?: string }).paymentStatus ?? "PENDING",
      customerName: f.customerName,
      customerEmail: null,
      customerPhone: f.customerPhone,
      shippingDivision: f.shippingDivision,
      shippingDistrict: f.shippingDistrict,
      shippingArea: f.shippingArea,
      shippingAddressLine: f.shippingAddressLine,
      subtotal: String(f.cod),
      discount: "0",
      shippingFee: "0",
      priceAdjustment: "0",
      total: String(f.cod),
      couponId: null,
      bundleId: null,
      bundleDiscount: "0",
      notes: null,
      adminNotes: null,
      courierNoteForLabel: f.note,
      trackingNumber: f.booked ? `SFR2610${consignment}` : null,
      carrier: f.booked ? "Steadfast" : null,
      courierConsignmentId: consignment,
      courierStatus: null,
      courierTrackingLink: f.booked ? `https://steadfast.com.bd/t/${consignment}` : null,
      courierBookedAt: f.booked ? "2026-10-16T10:00:00.000Z" : null,
      courierStatusSyncedAt: null,
      courierSyncError: null,
      partialDeliveryReconciledAt: null,
      followUpAt: null,
      callAttempts: 0,
      statusHistory: [],
      items,
      payment: { codToCollect: f.cod },
      deletedAt: null,
      createdAt: "2026-10-16T09:00:00.000Z",
      updatedAt: "2026-10-16T09:00:00.000Z",
    };
  });
}
