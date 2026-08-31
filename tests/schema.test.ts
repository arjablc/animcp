import { describe, expect, it } from 'vitest';
import {
	controlGroups,
	mergeConfig,
	parseDefinition,
	setConfigValue,
	type SchemaNode
} from '../src/lib/features/config/schema';

const schema: SchemaNode = {
	type: 'object',
	properties: {
		orb: {
			type: 'object',
			title: 'Orb',
			properties: {
				size: { type: 'number', minimum: 1, maximum: 100, multipleOf: 0.5 },
				color: { type: 'string', format: 'color' }
			}
		},
		enabled: { type: 'boolean' }
	}
};

describe('sketch config', () => {
	it('preserves compatible values and uses defaults for changed values', () => {
		const defaults = { orb: { size: 20, color: '#ffffff' }, enabled: true };
		const previous = { orb: { size: 80, color: 'invalid' }, enabled: false };
		expect(mergeConfig(schema, defaults, previous)).toEqual({
			orb: { size: 80, color: '#ffffff' },
			enabled: false
		});
	});

	it('validates patches against exact editable paths', () => {
		const config = { orb: { size: 20, color: '#ffffff' }, enabled: true };
		expect(setConfigValue(config, schema, ['orb', 'size'], 42).orb).toEqual({
			size: 42,
			color: '#ffffff'
		});
		expect(() => setConfigValue(config, schema, ['orb', 'missing'], 1)).toThrow(
			'Unknown config path'
		);
		expect(() => setConfigValue(config, schema, ['orb', 'size'], 101)).toThrow('above its maximum');
		expect(() => setConfigValue(config, schema, ['orb', 'size'], 12.25)).toThrow(
			'must be a multiple'
		);
	});

	it('creates grouped controls from nested schema', () => {
		const groups = controlGroups(schema, { orb: { size: 20, color: '#ffffff' }, enabled: true });
		expect(
			groups.map((group) => [group.title, group.fields.map((field) => field.path.join('.'))])
		).toEqual([
			['Orb', ['orb.size', 'orb.color']],
			['Sketch', ['enabled']]
		]);
	});

	it('rejects malformed definitions', () => {
		expect(() =>
			parseDefinition(
				{ color: 'red' },
				{ type: 'object', properties: { color: { type: 'string', format: 'color' } } }
			)
		).toThrow('six-digit hex color');
	});
});
