import * as prettierPluginSvelte from 'prettier-plugin-svelte';
import * as prettierPluginTailwindcss from 'prettier-plugin-tailwindcss';

/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	plugins: [prettierPluginSvelte, prettierPluginTailwindcss],
	overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }],
	tailwindStylesheet: './src/app.css'
};

export default config;
