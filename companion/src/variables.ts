import type ModuleInstance from './main.js'

export type VariablesSchema = {
	dmx_output: string
	dmx_output_status: string
	blackout: string
	active_scene_id: string
	active_scene_name: string
	vdj_connected: string
	master_dimmer: string
	effect_speed: string
	deck1_track: string
	deck1_bpm: string
	deck2_track: string
	deck2_bpm: string
	color_mode: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		dmx_output: { name: 'DMX output enabled (yes/no)' },
		dmx_output_status: { name: 'DMX output status (ON/OFF)' },
		blackout: { name: 'Blackout hold active (yes/no)' },
		active_scene_id: { name: 'Active scene ID' },
		active_scene_name: { name: 'Active scene name' },
		vdj_connected: { name: 'VirtualDJ connected (yes/no)' },
		master_dimmer: { name: 'Master dimmer (0–255)' },
		effect_speed: { name: 'Effect speed multiplier' },
		deck1_track: { name: 'Deck 1 track filename' },
		deck1_bpm: { name: 'Deck 1 BPM' },
		deck2_track: { name: 'Deck 2 track filename' },
		deck2_bpm: { name: 'Deck 2 BPM' },
		color_mode: { name: 'Color input mode (PUSH or TOGGLE)' },
	})
}

export function RefreshVariables(self: ModuleInstance): void {
	const client = self.client
	if (!client) return

	const activeScene = client.scenes.find((s) => s.id === client.state.activeSceneId)
	const deck1 = client.state.decks['1'] || {}
	const deck2 = client.state.decks['2'] || {}

	self.setVariableValues({
		dmx_output: client.state.dmxOutput ? 'yes' : 'no',
		dmx_output_status: client.state.dmxOutput ? 'ON' : 'OFF',
		blackout: client.state.blackoutHold ? 'yes' : 'no',
		active_scene_id: client.state.activeSceneId != null ? String(client.state.activeSceneId) : '',
		active_scene_name: activeScene?.name || '',
		vdj_connected: client.state.vdjConnected ? 'yes' : 'no',
		master_dimmer: String(client.state.masterDimmer),
		effect_speed: client.state.effectSpeed.toFixed(2),
		deck1_track: deck1.filename || deck1.filepath || '',
		deck1_bpm: deck1.bpm != null ? String(deck1.bpm) : '',
		deck2_track: deck2.filename || deck2.filepath || '',
		deck2_bpm: deck2.bpm != null ? String(deck2.bpm) : '',
		color_mode: client.state.colorPushMode ? 'PUSH' : 'TOGGLE',
	})
}
