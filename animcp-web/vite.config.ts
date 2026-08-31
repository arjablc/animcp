import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const p5Root = resolve(dirname(createRequire(import.meta.url).resolve('p5')), '..');
const p5Runtime = '\0p5-runtime';

export default defineConfig({
	plugins: [
		tailwindcss(),
		{
			name: 'p5-runtime-source',
			resolveId: (id) => (id === 'virtual:p5-runtime' ? p5Runtime : undefined),
			load: (id) =>
				id === p5Runtime
					? `export default ${JSON.stringify(readFileSync(resolve(p5Root, 'lib/p5.min.js'), 'utf8'))}`
					: undefined
		},
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],
	test: { include: ['tests/**/*.test.ts'] }
});
