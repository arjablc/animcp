import { json } from '@sveltejs/kit';

export function GET({ platform }) {
	const env = platform?.env;
	return json({ version: env?.APP_VERSION || 'dev' });
}
