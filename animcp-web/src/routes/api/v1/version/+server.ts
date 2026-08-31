import { json } from '@sveltejs/kit';

export function GET({ platform }) {
	const env = platform?.env as (Env & { APP_VERSION?: string }) | undefined;
	return json({ version: env?.APP_VERSION || 'dev' });
}
