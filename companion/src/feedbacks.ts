import type ModuleInstance from './main.js'

function optionValue(val: unknown): unknown {
	if (val !== null && typeof val === 'object' && 'value' in val) {
		return (val as { value: unknown }).value
	}
	return val
}

export type FeedbacksSchema = {
	dmx_output_on: { type: 'boolean'; options: Record<string, never> }
	blackout_active: { type: 'boolean'; options: Record<string, never> }
	scene_active: { type: 'boolean'; options: { scene_id: string } }
	fixture_enabled: { type: 'boolean'; options: { fixture_id: string } }
	vdj_connected: { type: 'boolean'; options: Record<string, never> }
	effect_slot_running: { type: 'boolean'; options: { slot: string } }
	color_toggle_mode: { type: 'boolean'; options: Record<string, never> }
	color_push_mode: { type: 'boolean'; options: Record<string, never> }
	sequence_playing: { type: 'boolean'; options: { deck: number } }
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		dmx_output_on: {
			name: 'DMX Output is ON',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x30d158,
				color: 0x000000,
			},
			options: [],
			callback: () => {
				const on = !!self.client?.state.dmxOutput
				return on
			},
		},

		blackout_active: {
			name: 'Blackout Hold is Active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff3b30,
				color: 0xffffff,
			},
			options: [],
			callback: () => !!self.client?.state.blackoutHold,
		},

		scene_active: {
			name: 'Scene is Active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x0a84ff,
				color: 0xffffff,
			},
			options: [
				{
					id: 'scene_id',
					type: 'textinput',
					label: 'Scene ID',
					default: '',
				},
			],
			callback: (feedback) => {
				if (!self.client) return false
				const sceneId = Number(optionValue(feedback.options.scene_id))
				return self.client.state.activeSceneId === sceneId
			},
		},

		fixture_enabled: {
			name: 'Fixture is Enabled',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x30d158,
				color: 0x000000,
			},
			options: [
				{
					id: 'fixture_id',
					type: 'textinput',
					label: 'Fixture ID',
					default: '',
				},
			],
			callback: (feedback) => {
				if (!self.client) return false
				const fixtureId = Number(optionValue(feedback.options.fixture_id))
				return self.client.isFixtureEnabled(fixtureId)
			},
		},

		vdj_connected: {
			name: 'VirtualDJ Connected',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x30d158,
				color: 0x000000,
			},
			options: [],
			callback: () => !!self.client?.state.vdjConnected,
		},

		effect_slot_running: {
			name: 'Effect Slot Running',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff9f0a,
				color: 0x000000,
			},
			options: [
				{
					id: 'slot',
					type: 'dropdown',
					label: 'Slot',
					default: 'color',
					choices: [
						{ id: 'color', label: 'Color' },
						{ id: 'motion', label: 'Motion' },
						{ id: 'multicell', label: 'Multicell' },
						{ id: 'rig', label: 'Rig' },
						{ id: 'sound', label: 'Sound' },
					],
				},
			],
			callback: (feedback) => {
				if (!self.client) return false
				return !!self.client.state.effectSlots[feedback.options.slot]
			},
		},

		color_toggle_mode: {
			name: 'Color Input is Toggle Mode',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff9f0a,
				color: 0x000000,
				text: 'TOGGLE',
			},
			options: [],
			callback: () => !self.client?.state.colorPushMode,
		},

		color_push_mode: {
			name: 'Color Input is Push Mode',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x30d158,
				color: 0x000000,
				text: 'PUSH',
			},
			options: [],
			callback: () => !!self.client?.state.colorPushMode,
		},

		sequence_playing: {
			name: 'Sequence Playing on Deck',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xbf5af2,
				color: 0xffffff,
			},
			options: [
				{
					id: 'deck',
					type: 'number',
					label: 'Deck',
					default: 1,
					min: 1,
					max: 4,
				},
			],
			callback: (feedback) => {
				if (!self.client) return false
				return !!self.client.state.seqPlaying[Number(feedback.options.deck)]
			},
		},
	})
}
