import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection[] = [
		{
			id: 'show_control',
			name: 'Show Control',
			definitions: [
				{
					id: 'essentials',
					name: 'Essentials',
					description: 'Drag onto Stream Deck, then assign actions from the DMX Controller connection',
					type: 'simple',
					presets: ['blackout', 'dmx_output', 'stop_fx', 'scene_off'],
				},
			],
		},
	]

	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		blackout: {
			type: 'simple',
			name: 'Blackout',
			style: {
				text: 'BLACKOUT',
				size: '14',
				color: 0xffffff,
				bgcolor: 0xff3b30,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},
		dmx_output: {
			type: 'simple',
			name: 'DMX Output',
			style: {
				text: 'OUTPUT\n$(DMX_Controller:dmx_output_status)',
				textExpression: true,
				size: '14',
				color: 0xffffff,
				bgcolor: 0xff3b30,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'dmx_output', options: { mode: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'dmx_output_on',
					options: {},
					style: { bgcolor: 0x30d158, color: 0x000000 },
					headline: 'DMX Output is ON',
				},
			],
		},
		stop_fx: {
			type: 'simple',
			name: 'Stop FX',
			style: {
				text: 'STOP FX',
				size: '14',
				color: 0xffffff,
				bgcolor: 0x333333,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},
		scene_off: {
			type: 'simple',
			name: 'Scene Off',
			style: {
				text: 'SCENE OFF',
				size: '14',
				color: 0xffffff,
				bgcolor: 0x555555,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},
	}

	self.setPresetDefinitions(structure, presets)
}
