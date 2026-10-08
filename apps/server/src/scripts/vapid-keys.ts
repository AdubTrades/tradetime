/**
 * Generate the Web Push key pair (do this once, then keep the same keys: changing them unsubscribes every device).
 * Usage: pnpm --filter @tc/server vapid-keys
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('Add these to the server environment (apps/server/.env.local, and Vercel later):\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
