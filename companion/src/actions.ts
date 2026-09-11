import type ModuleInstance from './main.js'
import { RefreshVariables } from './variables.js'

export type ActionsSchema = {	dmx_output: { options: { mode: string } }
	blackout: { options: { mode: string } }
	set_color: { options: { red: number; green: number; blue: number; white: number; mode: string } }
	set_color_press: { options: { red: number; green: number; blue: number; white: number } }
	set_color_release: { options: { red: number; green: number; blue: number; white: number } }
	release_color: { options: Record<string, never> }
	toggle_color_mode: { options: Record<string, never> }
	mirror_spin_block: { options: { mode: string } }
	strobe: { options: { mode: string } }
	smoke: { options: { mode: string } }
	fire: { options: { mode: string } }
	full_on: { options: { mode: string } }
	activate_scene: { options: { scene_id: string; scene_name: string; mode: string } }
	deactivate_scene: { options: Record<string, never> }
	toggle_fixture: { options: { fixture_id: string; fixture_name: string; mode: string } }
	run_effect: { options: { effect_id: string; effect_name: string; target: string; group_id: string; mode: string } }
	stop_effects: { options: { slot: string } }
	master_dimmer: { options: { value: number } }
	effect_speed: { options: { value: number } }
	sequence_load: { options: { deck: number; sequence_id: string } }
	sequence_play: { options: { deck: number } }
	sequence_pause: { options: { deck: number } }
	sequence_unload: { options: { deck: number } }
	refresh_lists: { options: Record<string, never> }
}

function logAction(self: ModuleInstance, action: string, detail?: Record<string, unknown>): void {
	const extra = detail && Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : ''
	self.log('info', `${action}${extra}`)
}

function requireClient(self: ModuleInstance, client: ModuleInstance['client'], action: string) {
	if (!client) {
		self.log('warn', `${action}: no connection — action skipped`)
		return false
	}
	return true
}

/** Unwrap Companion v4.3 ExpressionOrValue objects if they reach the callback raw. */
function optionValue(val: unknown): unknown {
	if (val !== null && typeof val === 'object' && 'value' in val) {
		return (val as { value: unknown }).value
	}
	return val
}

function colorOptions() {
	return [
		{ id: 'red', type: 'number', label: 'Red', default: 255, min: 0, max: 255 },
		{ id: 'green', type: 'number', label: 'Green', default: 0, min: 0, max: 255 },
		{ id: 'blue', type: 'number', label: 'Blue', default: 0, min: 0, max: 255 },
		{ id: 'white', type: 'number', label: 'White', default: 0, min: 0, max: 255 },
	] as const
}

async function runColorTrigger(
	client: NonNullable<ModuleInstance['client']>,
	event: { options: Record<string, unknown> },
	pressMode: 'on' | 'off',
) {
	const red = Number(optionValue(event.options.red))
	const green = Number(optionValue(event.options.green))
	const blue = Number(optionValue(event.options.blue))
	const white = Number(optionValue(event.options.white))
	const key = `color-${red}-${green}-${blue}-${white}`
	await client.trigger('color', { red, green, blue, white }, pressMode, key)
}

export function UpdateActions(self: ModuleInstance): void {
	const client = self.client

	self.setActionDefinitions({
		dmx_output: {
			name: 'DMX Output',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
				},
			],
			callback: async (event) => {
				logAction(self, 'dmx_output', { mode: event.options.mode })
				if (!requireClient(self, client, 'dmx_output')) return
				const mode = event.options.mode
				let enabled = client!.state.dmxOutput
				if (mode === 'toggle') enabled = !enabled
				else if (mode === 'on') enabled = true
				else enabled = false
				await client!.setDmxOutput(enabled)
				RefreshVariables(self)
				self.checkFeedbacks('dmx_output_on')
			},
		},

		blackout: {
			name: 'Blackout Hold',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'on',
					choices: [
						{ id: 'on', label: 'On (hold)' },
						{ id: 'off', label: 'Off (release)' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'on')
				logAction(self, 'blackout', { mode })
				if (!requireClient(self, client, 'blackout')) return
				await client!.trigger('blackout', {}, mode)
				await client!.syncState()
				self.checkAllFeedbacks()
			},
		},

		set_color_press: {
			name: 'Set Color (Press)',
			description:
				'Turns color on while pressed (PUSH mode). Add **Release Color** on the button release step — same as BLACKOUT uses press + release.',
			options: [...colorOptions()],
			callback: async (event) => {
				logAction(self, 'set_color_press', event.options as Record<string, unknown>)
				if (!requireClient(self, client, 'set_color_press')) return
				await runColorTrigger(client!, event, 'on')
				self.checkAllFeedbacks()
			},
		},

		set_color_release: {
			name: 'Set Color (Release)',
			description: 'Legacy — prefer **Release Color** on the release step (no RGB needed).',
			options: [...colorOptions()],
			callback: async (event) => {
				logAction(self, 'set_color_release', event.options as Record<string, unknown>)
				if (!requireClient(self, client, 'set_color_release')) return
				await runColorTrigger(client!, event, 'off')
				self.checkAllFeedbacks()
			},
		},

		release_color: {
			name: 'Release Color',
			description: 'Turn off the active push color on button release (PUSH mode only). Ignored in TOGGLE mode.',
			options: [],
			callback: async () => {
				logAction(self, 'release_color', {})
				if (!requireClient(self, client, 'release_color')) return
				if (!client!.state.colorPushMode) return
				await client!.releaseColor()
				self.checkAllFeedbacks()
			},
		},

		set_color: {
			name: 'Set Color',
			options: [
				...colorOptions(),
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'on',
					choices: [
						{ id: 'on', label: 'On (press)' },
						{ id: 'off', label: 'Off (release)' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const pressMode = String(optionValue(event.options.mode) || 'on')
				logAction(self, 'set_color', { ...event.options, mode: pressMode })
				if (!requireClient(self, client, 'set_color')) return
				const red = Number(optionValue(event.options.red))
				const green = Number(optionValue(event.options.green))
				const blue = Number(optionValue(event.options.blue))
				const white = Number(optionValue(event.options.white))
				const key = `color-${red}-${green}-${blue}-${white}`
				if (pressMode === 'toggle') {
					await client!.trigger('color', { red, green, blue, white }, 'toggle', key)
				} else {
					await runColorTrigger(client!, event, pressMode === 'off' ? 'off' : 'on')
				}
				self.checkAllFeedbacks()
			},
		},

		toggle_color_mode: {
			name: 'Toggle Color Input Mode',
			options: [],
			callback: async () => {
				logAction(self, 'toggle_color_mode', {})
				if (!requireClient(self, client, 'toggle_color_mode')) return
				await client!.toggleColorPushMode()
				RefreshVariables(self)
				self.checkAllFeedbacks()
			},
		},

		mirror_spin_block: {
			name: 'Mirror Ball: Block Sequence Spin',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'Block spin (on)' },
						{ id: 'off', label: 'Allow spin (off)' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'toggle')
				logAction(self, 'mirror_spin_block', { mode })
				if (!requireClient(self, client, 'mirror_spin_block')) return
				if (mode === 'toggle') await client!.toggleMirrorSpinBlocked()
				else await client!.setMirrorSpinBlocked(mode === 'on')
				RefreshVariables(self)
				self.checkFeedbacks('mirror_spin_blocked')
			},
		},

		strobe: {
			name: 'Strobe',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'on',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'on')
				logAction(self, 'strobe', { mode })
				if (!requireClient(self, client, 'strobe')) return
				await client!.trigger('strobe', {}, mode)
				self.checkAllFeedbacks()
			},
		},

		smoke: {
			name: 'Smoke',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'on',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'on')
				logAction(self, 'smoke', { mode })
				if (!requireClient(self, client, 'smoke')) return
				await client!.trigger('smoke', {}, mode)
				self.checkAllFeedbacks()
			},
		},

		fire: {
			name: 'Fire (Atmosphere)',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'on',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'on')
				logAction(self, 'fire', { mode })
				if (!requireClient(self, client, 'fire')) return
				await client!.trigger('fire', {}, mode)
				self.checkAllFeedbacks()
			},
		},

		full_on: {
			name: 'Full On',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'on',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'on')
				logAction(self, 'full_on', { mode })
				if (!requireClient(self, client, 'full_on')) return
				await client!.trigger('full_on', {}, mode)
				self.checkAllFeedbacks()
			},
		},

		activate_scene: {
			name: 'Activate Scene',
			options: [
				{
					id: 'scene_name',
					type: 'textinput',
					label: 'Scene name',
					default: '',
				},
				{
					id: 'scene_id',
					type: 'textinput',
					label: 'Scene ID (fallback if name empty)',
					default: '',
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'toggle')
				const sceneName = String(optionValue(event.options.scene_name) || '').trim()
				if (!requireClient(self, client, 'activate_scene')) return
				let sceneId: number
				try {
					sceneId = client!.resolveSceneId(
						String(optionValue(event.options.scene_id) || ''),
						sceneName || undefined,
					)
				} catch (err) {
					self.log('error', `activate_scene: ${(err as Error).message}`)
					return
				}
				logAction(self, 'activate_scene', { scene_id: sceneId, scene_name: sceneName, mode })
				await client!.activateSceneWithMode(sceneId, mode)
				self.checkFeedbacks('scene_active')
			},
		},

		deactivate_scene: {
			name: 'Deactivate Scene',
			options: [],
			callback: async () => {
				logAction(self, 'deactivate_scene')
				if (!requireClient(self, client, 'deactivate_scene')) return
				await client!.deactivateScene()
				self.checkFeedbacks('scene_active')
			},
		},

		toggle_fixture: {
			name: 'Toggle Fixture',
			options: [
				{
					id: 'fixture_name',
					type: 'textinput',
					label: 'Fixture name',
					default: '',
				},
				{
					id: 'fixture_id',
					type: 'textinput',
					label: 'Fixture ID',
					default: '',
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle enable/disable' },
						{ id: 'on', label: 'Enable' },
						{ id: 'off', label: 'Disable' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'toggle')
				const fixtureId = Number(optionValue(event.options.fixture_id))
				const fixtureName = String(optionValue(event.options.fixture_name) || '').trim()
				if (!requireClient(self, client, 'toggle_fixture')) return
				if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
					self.log('error', 'toggle_fixture: invalid fixture_id')
					return
				}
				logAction(self, 'toggle_fixture', { fixture_id: fixtureId, fixture_name: fixtureName, mode })
				await client!.syncState()
				const enabled = client!.isFixtureEnabled(fixtureId)
				if (mode === 'toggle') {
					await client!.setFixtureEnabled(fixtureId, !enabled)
				} else if (mode === 'on') {
					await client!.setFixtureEnabled(fixtureId, true)
				} else {
					await client!.setFixtureEnabled(fixtureId, false)
				}
				self.checkFeedbacks('fixture_enabled')
			},
		},

		run_effect: {
			name: 'Run Effect',
			options: [
				{
					id: 'effect_name',
					type: 'textinput',
					label: 'Effect name',
					default: '',
				},
				{
					id: 'effect_id',
					type: 'textinput',
					label: 'Effect ID (fallback if name empty)',
					default: '',
				},
				{
					id: 'target',
					type: 'dropdown',
					label: 'Fixtures',
					default: 'all',
					choices: [
						{ id: 'all', label: 'All fixtures' },
						{ id: 'group', label: 'Fixture group' },
					],
				},
				{
					id: 'group_id',
					type: 'textinput',
					label: 'Group ID (when target = group)',
					default: '',
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
				},
			],
			callback: async (event) => {
				const mode = String(optionValue(event.options.mode) || 'toggle')
				const target = String(optionValue(event.options.target) || 'all')
				const groupId = String(optionValue(event.options.group_id) || '')
				const effectName = String(optionValue(event.options.effect_name) || '').trim()
				if (!requireClient(self, client, 'run_effect')) return
				let effectId: number
				try {
					effectId = client!.resolveEffectId(
						String(optionValue(event.options.effect_id) || ''),
						effectName || undefined,
					)
				} catch (err) {
					self.log('error', `run_effect: ${(err as Error).message}`)
					return
				}
				logAction(self, 'run_effect', { effect_id: effectId, effect_name: effectName, target, mode })
				try {
					await client!.runEffectWithMode(effectId, target, groupId, mode)
				} catch (err) {
					self.log('error', `run_effect: ${(err as Error).message}`)
					return
				}
				self.checkFeedbacks('effect_slot_running')
			},
		},

		stop_effects: {
			name: 'Stop Effects',
			options: [
				{
					id: 'slot',
					type: 'dropdown',
					label: 'Slot',
					default: 'all',
					choices: [
						{ id: 'all', label: 'All slots' },
						{ id: 'color', label: 'Color' },
						{ id: 'motion', label: 'Motion' },
						{ id: 'multicell', label: 'Multicell' },
						{ id: 'rig', label: 'Rig' },
						{ id: 'sound', label: 'Sound' },
						{ id: 'mirror', label: 'Mirror ball' },
					],
				},
			],
			callback: async (event) => {
				logAction(self, 'stop_effects', { slot: event.options.slot })
				if (!requireClient(self, client, 'stop_effects')) return
				const slot = event.options.slot === 'all' ? undefined : event.options.slot
				await client!.stopEffects(slot)
				self.checkAllFeedbacks()
			},
		},

		master_dimmer: {
			name: 'Master Dimmer',
			options: [
				{
					id: 'value',
					type: 'number',
					label: 'Level (0–255)',
					default: 255,
					min: 0,
					max: 255,
				},
			],
			callback: async (event) => {
				logAction(self, 'master_dimmer', { value: event.options.value })
				if (!requireClient(self, client, 'master_dimmer')) return
				await client!.setMasterDimmer(Number(event.options.value))
			},
		},

		effect_speed: {
			name: 'Effect Speed',
			options: [
				{
					id: 'value',
					type: 'number',
					label: 'Multiplier (0.1–3.0)',
					default: 1,
					min: 0.1,
					max: 3,
					step: 0.1,
				},
			],
			callback: async (event) => {
				logAction(self, 'effect_speed', { value: event.options.value })
				if (!requireClient(self, client, 'effect_speed')) return
				await client!.setEffectSpeed(Number(event.options.value))
			},
		},

		sequence_load: {
			name: 'Sequence: Load',
			options: [
				{
					id: 'deck',
					type: 'number',
					label: 'Deck',
					default: 1,
					min: 1,
					max: 4,
				},
				{
					id: 'sequence_id',
					type: 'dropdown',
					label: 'Sequence',
					default: client?.sequenceChoices()[0]?.id || '',
					choices: client?.sequenceChoices() || [],
				},
			],
			callback: async (event) => {
				logAction(self, 'sequence_load', {
					deck: event.options.deck,
					sequence_id: event.options.sequence_id,
				})
				if (!requireClient(self, client, 'sequence_load')) return
				client!.sendSequenceCommand('load', Number(event.options.deck), Number(event.options.sequence_id))
			},
		},

		sequence_play: {
			name: 'Sequence: Play',
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
			callback: async (event) => {
				logAction(self, 'sequence_play', { deck: event.options.deck })
				if (!requireClient(self, client, 'sequence_play')) return
				client!.sendSequenceCommand('play', Number(event.options.deck))
				self.checkAllFeedbacks()
			},
		},

		sequence_pause: {
			name: 'Sequence: Pause',
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
			callback: async (event) => {
				logAction(self, 'sequence_pause', { deck: event.options.deck })
				if (!requireClient(self, client, 'sequence_pause')) return
				client!.sendSequenceCommand('pause', Number(event.options.deck))
				self.checkAllFeedbacks()
			},
		},

		sequence_unload: {
			name: 'Sequence: Unload',
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
			callback: async (event) => {
				logAction(self, 'sequence_unload', { deck: event.options.deck })
				if (!requireClient(self, client, 'sequence_unload')) return
				client!.sendSequenceCommand('unload', Number(event.options.deck))
				self.checkAllFeedbacks()
			},
		},

		refresh_lists: {
			name: 'Refresh Scenes / Effects / Sequences',
			options: [],
			callback: async () => {
				logAction(self, 'refresh_lists')
				if (!requireClient(self, client, 'refresh_lists')) return
				await client!.refreshLists()
				self.updateActions()
			},
		},
	})
}
