import { defineEnvVars } from '@sveltejs/kit/env';

const required = (name: string) => (value: string | undefined) => {
	if (!value) throw new Error(`${name} is not set`);
	return value;
};
const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Turso database URL (libsql://…) or file:local.db',
		schema: required('DATABASE_URL')
	},
	DATABASE_AUTH_TOKEN: { description: 'Turso auth token (empty for file: DBs)', schema: optional },
	ADMIN_EMAIL: { description: 'Admin login email', schema: required('ADMIN_EMAIL') },
	ADMIN_PASSWORD: {
		description: 'Admin login password (plain text, keep .env private)',
		schema: (value: string | undefined) => {
			if (!value || value.length < 10)
				throw new Error('ADMIN_PASSWORD must be at least 10 characters');
			return value;
		}
	},
	SESSION_SECRET: {
		description:
			'Random string (32+ chars) used to sign session cookies. Generate: npm run gen-secrets',
		schema: (value: string | undefined) => {
			if (!value || value.length < 32)
				throw new Error('SESSION_SECRET must be at least 32 characters');
			return value;
		}
	},
	STORE_NAME: {
		description: 'Shown in the sidebar and page titles. Default: the Shopify shop name',
		schema: optional
	},
	SHOPIFY_STORE_DOMAIN: { description: 'e.g. sigma-leather.myshopify.com', schema: optional },
	SHOPIFY_CLIENT_ID: { description: 'Dev Dashboard app → Settings → Client ID', schema: optional },
	SHOPIFY_CLIENT_SECRET: {
		description: 'Dev Dashboard app → Settings → Secret',
		schema: optional
	},
	SHOPIFY_ADMIN_TOKEN: {
		description:
			'Shopify Admin API access token. Alternative: SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET.',
		schema: optional
	},
	POSTEX_TOKEN: { description: 'PostEx merchant API token', schema: optional },
	CRON_SECRET: { description: 'Secret Vercel cron sends as Bearer token', schema: optional }
});
