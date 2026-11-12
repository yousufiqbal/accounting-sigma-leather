// Usage: npm run gen-secrets
// Prints fresh SESSION_SECRET and CRON_SECRET lines to paste into .env
import { randomBytes } from 'node:crypto';

console.log(`SESSION_SECRET="${randomBytes(32).toString('base64url')}"`);
console.log(`CRON_SECRET="${randomBytes(24).toString('base64url')}"`);
