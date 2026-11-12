export type Courier = 'postex' | 'dex' | 'manual';
export type ShipmentStatus = 'booked' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';

/**
 * One parcel as reported by a source (API row, CSV row, xlsx row, manual entry).
 * Money in paisa. Timestamps as UTC ISO strings. `undefined` = source has no info.
 */
export type NormalizedShipment = {
	courier: Courier;
	trackingNo: string;
	originalTrackingNo?: string | null;
	orderRefRaw?: string | null;
	orderName?: string | null;
	orderId?: string | null; // shopify order id when the source carries it (DEX)
	extraParcel?: boolean;
	status: ShipmentStatus;
	courierStatus?: string | null;
	bookedAt?: string | null;
	pickupAt?: string | null;
	finalAt?: string | null;
	weightKg?: string | null;
	province?: string | null;
	city?: string | null;
	cod?: number;
	fee?: number;
	feeTax?: number;
	returnFee?: number;
	returnFeeTax?: number;
	otherFees?: number;
	itwh?: number;
	stwh?: number;
	netPayable?: number;
	feesEstimated?: boolean;
	taxesEstimated?: boolean;
	statementNumber?: string | null;
	settledAt?: string | null;
	raw?: unknown;
};

export type ParsedStatement = {
	courier: Courier;
	number: string;
	periodStart?: string | null;
	periodEnd?: string | null;
	statementDate?: string | null;
};

export type ParsedFile = {
	courier: Courier;
	kind: 'dex_xlsx' | 'postex_csv';
	rows: NormalizedShipment[];
	statements: ParsedStatement[];
	/** Problems that block the import (bad totals, unknown columns…). */
	errors: string[];
	/** Things worth knowing that don't block. */
	warnings: string[];
};
