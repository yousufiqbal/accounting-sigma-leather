import { error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { SHOPIFY_STORE_DOMAIN } from '$app/env/private';
import { db } from '#lib/server/db/index.js';
import { orderProfits } from '#lib/server/order-profit.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const name = params.name.replace(/^#/, '');
	const order = await db.query.orders.findFirst({
		where: (o, { eq }) => eq(o.name, name)
	});
	if (!order) error(404, `Order #${name} not found`);

	const [profit] = await orderProfits({ ids: [order.id] });
	const courierOnly = !!order.cancelledAt || order.total <= 0;

	// Items actually sent (cancelled-but-delivered orders: the ordered quantity).
	const lines = (await db.all(sql`
		select l.id, l.title, l.sku, l.variant_id as variantId,
			v.product_title as productTitle, v.variant_title as variantTitle, v.image_url as imageUrl,
			coalesce(v.cost_source, 'none') as costSource,
			${courierOnly ? sql`coalesce(nullif(l.qty, 0), l.ordered_qty, 0)` : sql`l.qty`} as qty,
			l.unit_price_paisa as unitPrice, l.line_discount_paisa as discount,
			coalesce(l.cost_snapshot_paisa, v.avg_cost_paisa, 0) as unitCost,
			l.cost_snapshot_paisa is not null as frozen,
			(l.cost_estimated = 1 or (l.cost_snapshot_paisa is null and coalesce(v.cost_source, 'none') != 'batch')) as estimated
		from order_lines l left join variants v on v.id = l.variant_id
		where l.order_id = ${order.id}
		order by l.unit_price_paisa desc`)) as {
		id: string;
		title: string;
		sku: string | null;
		variantId: string | null;
		productTitle: string | null;
		variantTitle: string | null;
		imageUrl: string | null;
		costSource: string;
		qty: number;
		unitPrice: number;
		discount: number;
		unitCost: number;
		frozen: number;
		estimated: number;
	}[];

	const parcels = (await db.all(sql`
		select s.id, s.courier, s.tracking_no as trackingNo, s.status, s.courier_status as courierStatus,
			s.booked_at as bookedAt, s.final_at as finalAt, s.city, s.weight_kg as weightKg,
			s.cod_paisa as cod, s.fee_paisa as fee, s.fee_tax_paisa as feeTax,
			s.return_fee_paisa as returnFee, s.return_fee_tax_paisa as returnFeeTax,
			s.other_fees_paisa as otherFees, s.itwh_paisa as itwh, s.stwh_paisa as stwh,
			s.net_payable_paisa as net, s.fees_estimated as feesEstimated, s.taxes_estimated as taxesEstimated,
			s.settled_at as settledAt, s.match_status as matchStatus, s.conflict_note as conflictNote,
			st.number as statement, st.statement_date as statementDate
		from shipments s left join statements st on st.id = s.statement_id
		where s.order_id = ${order.id} and s.status != 'cancelled'
		order by coalesce(s.final_at, s.booked_at) desc`)) as {
		id: string;
		courier: 'postex' | 'dex' | 'manual';
		trackingNo: string;
		status: string;
		courierStatus: string | null;
		bookedAt: string | null;
		finalAt: string | null;
		city: string | null;
		weightKg: string | null;
		cod: number;
		fee: number;
		feeTax: number;
		returnFee: number;
		returnFeeTax: number;
		otherFees: number;
		itwh: number;
		stwh: number;
		net: number;
		feesEstimated: number;
		taxesEstimated: number;
		settledAt: string | null;
		matchStatus: string;
		conflictNote: string | null;
		statement: string | null;
		statementDate: string | null;
	}[];

	const shipped =
		order.fulfillmentStatus === 'FULFILLED' || order.fulfillmentStatus === 'PARTIALLY_FULFILLED';
	return {
		order: {
			...order,
			tags: JSON.parse(order.tags ?? '[]') as string[],
			gateways: JSON.parse(order.gateways ?? '[]') as string[],
			discountCodes: JSON.parse(order.discountCodes ?? '[]') as {
				kind: string;
				label: string;
				value: string | number;
				amount: number;
			}[]
		},
		courierOnly,
		lines: lines.filter((l) => l.qty > 0),
		parcels,
		profit: profit ?? null,
		canRecord: shipped && !order.cancelledAt && parcels.length === 0,
		shopifyUrl: SHOPIFY_STORE_DOMAIN
			? `https://${SHOPIFY_STORE_DOMAIN}/admin/orders/${order.id}`
			: null
	};
};
