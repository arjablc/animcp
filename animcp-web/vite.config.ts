import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const p5Root = resolve(dirname(require.resolve('p5')), '..');
const p5Runtime = '\0p5-runtime';
const p5BrushRuntime = '\0p5-brush-runtime';

export default defineConfig({
	plugins: [
		tailwindcss(),
		{
			name: 'p5-runtime-source',
			resolveId: (id) =>
				id === 'virtual:p5-runtime'
					? p5Runtime
					: id === 'virtual:p5-brush-runtime'
						? p5BrushRuntime
						: undefined,
			load: (id) => {
				if (id === p5Runtime)
					return `export default ${JSON.stringify(readFileSync(resolve(p5Root, 'lib/p5.min.js'), 'utf8'))}`;
				if (id === p5BrushRuntime)
					return `export default ${JSON.stringify(readFileSync(require.resolve('p5.brush'), 'utf8'))}`;
			}
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
