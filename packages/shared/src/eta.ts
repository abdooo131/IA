// The Egyptian Tax Authority (ETA) e-invoice document, version 1.0, and its canonical form:
// the exact text the company's electronic signature is made over.
//
//   document (JSON) ──serialize──▶ canonical text ──sign with the USB token──▶ signature
//                                                    (on the finance PC, CAdES-BES)
//   document + signature ──submit──▶ ETA ──▶ uuid, then Valid or Invalid

export type EtaValue = string | number | EtaObject | EtaValue[];
export interface EtaObject {
  [key: string]: EtaValue;
}

/**
 * ETA's canonical serialization: every property name in upper case and quotes, followed
 * by its value; an array gives its name once and again before each element; plain values
 * are quoted as written in the JSON. The "signatures" property is left out.
 */
export function etaCanonical(value: EtaValue, name?: string): string {
  if (Array.isArray(value))
    return value.map((v) => `"${name!.toUpperCase()}"${etaCanonical(v, name)}`).join('');
  if (typeof value === 'object') {
    let out = '';
    for (const [key, v] of Object.entries(value)) {
      if (key === 'signatures') continue;
      // An array: its name once, then its name again before every element.
      out += `"${key.toUpperCase()}"${etaCanonical(v, key)}`;
    }
    return out;
  }
  return `"${String(value)}"`;
}

/** Piastres as EGP with at most two decimals, as a JSON number (12.5, not "12.50"). */
const egp = (piastres: number) => Math.round(piastres) / 100;

export interface EtaParty {
  /** B: a registered company; P: a person */
  type: 'B' | 'P';
  id: string;
  name: string;
  governorate: string;
  regionCity: string;
  street: string;
  buildingNumber: string;
  branchId?: string;
}

export interface EtaLine {
  description: string;
  itemCode: string;
  internalCode: string;
  quantity: number;
  netPiastres: number;
  vatPiastres: number;
  /** VAT rate in percent (14) */
  vatRate: number;
}

/** Builds an ETA document (I invoice, C credit note) from our invoice, ready to sign. */
export function etaDocument(input: {
  type: 'I' | 'C';
  issuer: EtaParty;
  receiver: EtaParty;
  issuedAt: Date;
  activityCode: string;
  internalId: string;
  lines: EtaLine[];
  /** For a credit note: the uuid of the invoice it corrects */
  references?: string[];
}): EtaObject {
  const party = (p: EtaParty, issuer: boolean): EtaObject => ({
    address: {
      ...(issuer ? { branchID: p.branchId ?? '0' } : {}),
      country: 'EG',
      governate: p.governorate,
      regionCity: p.regionCity,
      street: p.street,
      buildingNumber: p.buildingNumber,
    },
    type: p.type,
    id: p.id,
    name: p.name,
  });
  const lines: EtaObject[] = input.lines.map((l) => {
    const unit = Math.round(l.netPiastres / l.quantity);
    const net = egp(l.netPiastres);
    return {
      description: l.description,
      itemType: 'EGS',
      itemCode: l.itemCode,
      unitType: 'EA',
      quantity: l.quantity,
      internalCode: l.internalCode,
      salesTotal: net,
      total: egp(l.netPiastres + l.vatPiastres),
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal: net,
      itemsDiscount: 0,
      unitValue: { currencySold: 'EGP', amountEGP: egp(unit) },
      discount: { rate: 0, amount: 0 },
      taxableItems: [
        { taxType: 'T1', amount: egp(l.vatPiastres), subType: 'V009', rate: l.vatRate },
      ],
    };
  });
  const net = input.lines.reduce((s, l) => s + l.netPiastres, 0);
  const vat = input.lines.reduce((s, l) => s + l.vatPiastres, 0);
  return {
    issuer: party(input.issuer, true),
    receiver: party(input.receiver, false),
    documentType: input.type,
    documentTypeVersion: '1.0',
    // ETA wants UTC without fractions: 2026-11-30T21:59:59Z
    dateTimeIssued: `${input.issuedAt.toISOString().slice(0, 19)}Z`,
    taxpayerActivityCode: input.activityCode,
    internalID: input.internalId,
    ...(input.references?.length ? { references: input.references } : {}),
    invoiceLines: lines,
    totalDiscountAmount: 0,
    totalSalesAmount: egp(net),
    netAmount: egp(net),
    taxTotals: [{ taxType: 'T1', amount: egp(vat) }],
    totalAmount: egp(net + vat),
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0,
  };
}
