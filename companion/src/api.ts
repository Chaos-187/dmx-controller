export type Choice = { id: string; label: string }

const MOVING_HEAD_EFFECT_TYPES = new Set([
	'pan_sweep', 'tilt_sweep', 'circle', 'figure_eight', 'random_move', 'fan', 'nod',
])
const MULTICELL_EFFECT_TYPES = new Set([
	'chase', 'comet', 'scanner', 'buildup', 'segments', 'ripple', 'cell_strobe', 'gradient',
])
const RIG_EFFECT_TYPES = new Set([
	'rig_chase', 'rig_color_wave', 'rig_sweep', 'rig_alternate', 'rig_converge', 'rig_rainbow',
	'rig_depth_chase', 'rig_depth_wave', 'rig_round_robin',
])
const SOUND_EFFECT_TYPES = new Set([
	'sound_pulse', 'sound_strobe', 'sound_chase', 'sound_wave', 'sound_flash',
	'sound_vu', 'sound_vu_tb', 'sound_vu_lr',
])
const MIRROR_BALL_EFFECT_TYPES = new Set([
	'mirror_glow', 'mirror_soft_shift', 'mirror_slow_spin', 'mirror_glitter',
	'mirror_spin_cw', 'mirror_spin_ccw', 'mirror_spin_fast_cw', 'mirror_spin_fast_ccw',
	'mirror_motor_cw', 'mirror_motor_ccw', 'mirror_motor_slow',
	'mirror_motor_fast_cw', 'mirror_motor_fast_ccw', 'mirror_motor_party',
])

export function normalizeEffectName(name: string): string {
	return String(name || '')
		.normalize('NFKC')
		.replace(/\u2192/g, '->')
		.replace(/\u2190/g, '<-')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
}

export function effectSlotForType(effectType: string): string {
	if (MIRROR_BALL_EFFECT_TYPES.has(effectType)) return 'mirror'
	if (MOVING_HEAD_EFFECT_TYPES.has(effectType)) return 'motion'
	if (MULTICELL_EFFECT_TYPES.has(effectType)) return 'multicell'
	if (RIG_EFFECT_TYPES.has(effectType)) return 'rig'
	if (SOUND_EFFECT_TYPES.has(effectType)) return 'sound'
	return 'color'
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export type SceneRow = { id: number; name: string }
export type EffectRow = { id: number; name: string; type: string; fixture_target?: string }
export type GroupRow = { id: number; name: string; fixture_ids: number[] }
export type FixtureRow = { id: number; name: string; category?: string; type_name?: string; channels?: { type: string }[] }
export type SequenceRow = { id: number; name: string }

export type DmxState = {
	dmxOutput: boolean
	blackoutHold: boolean
	activeSceneId: number | null
	masterDimmer: number
	effectSpeed: number
	vdjConnected: boolean
	effectSlots: Record<string, { effectId: number; name: string; type: string } | null>
	decks: Record<string, { filepath?: string; bpm?: number; play?: number; filename?: string }>
	seqPlaying: Record<number, boolean>
	disabledFixtures: number[]
	colorPushMode: boolean
}

export class DmxControllerClient {
	readonly baseUrl: string
	readonly wsUrl: string

	state: DmxState = {
		dmxOutput: false,
		blackoutHold: false,
		activeSceneId: null,
		masterDimmer: 255,
		effectSpeed: 1,
		vdjConnected: false,
		effectSlots: {},
		decks: {},
		seqPlaying: {},
		disabledFixtures: [],
		colorPushMode: true,
	}

	scenes: SceneRow[] = []
	effects: EffectRow[] = []
	groups: GroupRow[] = []
	fixtures: FixtureRow[] = []
	sequences: SequenceRow[] = []

	onChange: (() => void) | null = null
	onLog: ((level: LogLevel, message: string) => void) | null = null
	onConnectionChange: ((connected: boolean) => void) | null = null

	connected = false

	private ws: WebSocket | null = null
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private destroyed = false
	private readonly reconnectDelayMs = 5000

	constructor(host: string, port: number) {
		this.baseUrl = `http://${host}:${port}`
		this.wsUrl = `ws://${host}:${port}`
	}

	/** Connect and keep retrying until {@link destroy} is called. */
	async start(): Promise<void> {
		this.destroyed = false
		await this.attemptConnection()
	}

	destroy(): void {
		this.destroyed = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		if (this.ws) {
			this.ws.close()
			this.ws = null
		}
		this.setConnected(false)
	}

	private setConnected(connected: boolean): void {
		if (this.connected === connected) return
		this.connected = connected
		if (connected) {
			this.log('info', `Connected to DMX Controller at ${this.baseUrl}`)
		} else {
			this.log('warn', `Lost connection to DMX Controller at ${this.baseUrl}`)
		}
		this.onConnectionChange?.(connected)
	}

	private scheduleReconnect(): void {
		if (this.destroyed || this.reconnectTimer) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.attemptConnection().catch(() => {})
		}, this.reconnectDelayMs)
	}

	private markUnreachable(): void {
		if (this.ws) {
			const previous = this.ws
			this.ws = null
			previous.onclose = () => {}
			previous.onerror = () => {}
			previous.close()
		}
		this.setConnected(false)
		this.scheduleReconnect()
	}

	private async attemptConnection(): Promise<void> {
		if (this.destroyed) return
		try {
			await this.fetch('/api/version')
			await this.refreshLists()
			await this.syncState()
			this.connectWebSocket()
			this.setConnected(true)
		} catch (err) {
			this.setConnected(false)
			this.log('warn', `Connection failed: ${(err as Error).message} — retrying in ${this.reconnectDelayMs / 1000}s`)
			this.scheduleReconnect()
		}
	}

	private notify(): void {
		this.onChange?.()
	}

	private log(level: LogLevel, message: string): void {
		this.onLog?.(level, message)
	}

	/** DMX output / blackout sync via WebSocket `dmxOutput` and `touchBlackoutHold` events. */

	private connectWebSocket(): void {
		if (this.destroyed) return
		if (this.ws) {
			const previous = this.ws
			this.ws = null
			previous.onclose = () => {}
			previous.onerror = () => {}
			previous.close()
		}

		const ws = new WebSocket(this.wsUrl)
		this.ws = ws

		ws.onopen = () => {
			this.syncState().catch(() => this.markUnreachable())
		}

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(String(event.data))
				this.handleWsMessage(msg)
			} catch {
				// ignore invalid JSON
			}
		}

		ws.onclose = () => {
			this.ws = null
			if (!this.destroyed) this.markUnreachable()
		}

		ws.onerror = () => {
			ws.close()
		}
	}

	private handleWsMessage(msg: Record<string, unknown>): void {
		let changed = false
		switch (msg.type) {
			case 'state': {
				const state = msg.state as { connected?: boolean; decks?: DmxState['decks'] }
				if (state) {
					if (!!state.connected !== this.state.vdjConnected) {
						this.state.vdjConnected = !!state.connected
						changed = true
					}
					if (state.decks) {
						this.state.decks = state.decks
						changed = true
					}
				}
				break
			}
			case 'connection':
				if (!!msg.connected !== this.state.vdjConnected) {
					this.state.vdjConnected = !!msg.connected
					changed = true
				}
				break
			case 'dmxOutput': {
				const enabled = !!msg.enabled
				if (enabled !== this.state.dmxOutput) {
					this.state.dmxOutput = enabled
					this.log('info', `DMX output state → ${enabled ? 'ON' : 'OFF'} (websocket)`)
					changed = true
				}
				break
			}
			case 'touchBlackoutHold': {
				const active = !!msg.active
				if (active !== this.state.blackoutHold) {
					this.state.blackoutHold = active
					changed = true
				}
				break
			}
			case 'companionColorMode': {
				const push = msg.pushMode !== undefined ? !!msg.pushMode : !!msg.holdMode
				if (push !== this.state.colorPushMode) {
					this.state.colorPushMode = push
					this.log('info', `Color input mode → ${push ? 'PUSH' : 'TOGGLE'} (websocket)`)
					changed = true
				}
				break
			}
			case 'masterDimmer':
				if (typeof msg.value === 'number' && msg.value !== this.state.masterDimmer) {
					this.state.masterDimmer = msg.value
					changed = true
				}
				break
			case 'effectSpeed':
				if (typeof msg.value === 'number' && msg.value !== this.state.effectSpeed) {
					this.state.effectSpeed = msg.value
					changed = true
				}
				break
			case 'scene_activated': {
				const sceneId = typeof msg.sceneId === 'number' ? msg.sceneId : null
				if (sceneId !== this.state.activeSceneId) {
					this.state.activeSceneId = sceneId
					changed = true
				}
				break
			}
			case 'scene_deactivated':
				if (this.state.activeSceneId !== null) {
					this.state.activeSceneId = null
					changed = true
				}
				break
			case 'touchFixtureDisable': {
				const fixtureId = Number(msg.fixtureId)
				if (!Number.isFinite(fixtureId)) break
				const disabled = !!msg.disabled
				const set = new Set(this.state.disabledFixtures)
				if (disabled) set.add(fixtureId)
				else set.delete(fixtureId)
				this.state.disabledFixtures = [...set]
				changed = true
				break
			}
			case 'seq_playing':
				if (typeof msg.deck === 'number') {
					this.state.seqPlaying[msg.deck] = !!msg.playing
					changed = true
				}
				break
			case 'seq_unloaded':
				if (typeof msg.deck === 'number') {
					delete this.state.seqPlaying[msg.deck]
					changed = true
				}
				break
		}
		if (changed) this.notify()
	}

	sendSequenceCommand(action: string, deck: number, sequenceId?: number): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket not connected')
		}
		const payload: Record<string, unknown> = { type: 'sequence', action, deck }
		if (sequenceId != null) payload.sequenceId = sequenceId
		this.ws.send(JSON.stringify(payload))
	}

	async fetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
		const method = init?.method || 'GET'
		if (method !== 'GET') this.log('debug', `${method} ${path}`)
		let res: Response
		try {
			res = await fetch(`${this.baseUrl}${path}`, {
				...init,
				headers: {
					'Content-Type': 'application/json',
					...(init?.headers || {}),
				},
			})
		} catch (err) {
			const msg = (err as Error).message
			this.log('error', `${method} ${path} failed: ${msg}`)
			this.markUnreachable()
			throw new Error(msg)
		}
		if (!res.ok) {
			const text = await res.text().catch(() => '')
			const err = `${res.status} ${res.statusText}${text ? `: ${text}` : ''}`
			this.log('error', `${method} ${path} failed: ${err}`)
			if (res.status >= 500 || res.status === 408) this.markUnreachable()
			throw new Error(err)
		}
		if (res.status === 204) return undefined as T
		return (await res.json()) as T
	}

	async refreshLists(): Promise<void> {
		const [scenes, effects, groups, fixtures, sequences] = await Promise.all([
			this.fetch<SceneRow[]>('/api/scenes'),
			this.fetch<EffectRow[]>('/api/effects'),
			this.fetch<GroupRow[]>('/api/groups'),
			this.fetch<FixtureRow[]>('/api/fixtures'),
			this.fetch<SequenceRow[]>('/api/sequences'),
		])
		this.scenes = scenes
		this.effects = effects
		this.groups = groups
		this.fixtures = fixtures
		this.sequences = sequences
	}

	async syncState(): Promise<void> {
		const [output, scene, effects, touch] = await Promise.all([
			this.fetch<{ enabled: boolean }>('/api/dmx/output'),
			this.fetch<{ activeSceneId: number | null }>('/api/scenes/active'),
			this.fetch<{ slots: DmxState['effectSlots'] }>('/api/effects/status'),
			this.fetch<{ disabledFixtures?: number[]; companionColorPushMode?: boolean; companionColorHoldMode?: boolean }>('/api/touch/state'),
		])
		this.state.dmxOutput = !!output.enabled
		this.state.activeSceneId = scene.activeSceneId
		this.state.effectSlots = effects.slots || {}
		this.state.disabledFixtures = touch.disabledFixtures || []
		const pushMode = touch.companionColorPushMode ?? touch.companionColorHoldMode
		if (pushMode !== undefined) {
			this.state.colorPushMode = !!pushMode
		}
		this.notify()
	}

	async setDmxOutput(enabled: boolean): Promise<void> {
		this.log('info', `DMX output → ${enabled ? 'ON' : 'OFF'}`)
		await this.fetch('/api/dmx/output', {
			method: 'POST',
			body: JSON.stringify({ enabled }),
		})
		this.state.dmxOutput = enabled
		this.notify()
	}

	async setBlackoutHold(active: boolean): Promise<void> {
		await this.fetch('/api/touch/blackout-hold', {
			method: 'POST',
			body: JSON.stringify({ active }),
		})
		this.state.blackoutHold = active
		this.notify()
	}

	async setMasterDimmer(value: number): Promise<void> {
		const val = Math.max(0, Math.min(255, Math.round(value)))
		await this.fetch('/api/touch/master-dimmer', {
			method: 'POST',
			body: JSON.stringify({ value: val }),
		})
		this.state.masterDimmer = val
		this.notify()
	}

	async setEffectSpeed(value: number): Promise<void> {
		const val = Math.max(0.1, Math.min(3.0, value))
		await this.fetch('/api/touch/effect-speed', {
			method: 'POST',
			body: JSON.stringify({ value: val }),
		})
		this.state.effectSpeed = val
		this.notify()
	}

	async activateScene(sceneId: number): Promise<void> {
		await this.fetch(`/api/scenes/${sceneId}/activate`, { method: 'POST' })
		this.state.activeSceneId = sceneId
		this.notify()
	}

	async deactivateScene(): Promise<void> {
		await this.fetch('/api/scenes/deactivate', { method: 'POST' })
		this.state.activeSceneId = null
		this.notify()
	}

	isFixtureEnabled(fixtureId: number): boolean {
		return !this.state.disabledFixtures.includes(fixtureId)
	}

	async setFixtureEnabled(fixtureId: number, enabled: boolean): Promise<void> {
		const res = await this.fetch<{ disabledFixtures?: number[] }>('/api/touch/fixture-disable', {
			method: 'POST',
			body: JSON.stringify({ fixtureId, disabled: !enabled }),
		})
		this.state.disabledFixtures = res.disabledFixtures || []
		this.notify()
	}

	resolveSceneId(sceneIdRaw: string | number | undefined, sceneName?: string): number {
		const name = sceneName?.trim()
		if (name) {
			const exact = this.scenes.find((s) => s.name === name)
			if (exact) return exact.id
			const norm = normalizeEffectName(name)
			const loose = this.scenes.find((s) => normalizeEffectName(s.name) === norm)
			if (loose) return loose.id
		}
		const id = Number(sceneIdRaw)
		if (Number.isFinite(id) && id > 0) {
			const byId = this.scenes.find((s) => s.id === id)
			if (byId) return byId.id
		}
		throw new Error(`Scene not found: ${name || sceneIdRaw || '(empty)'}`)
	}

	async activateSceneWithMode(sceneId: number, mode: string): Promise<void> {
		await this.syncState()
		if (mode === 'toggle' && this.state.activeSceneId === sceneId) {
			await this.deactivateScene()
			return
		}
		if (mode === 'off') {
			if (this.state.activeSceneId === sceneId) await this.deactivateScene()
			return
		}
		await this.activateScene(sceneId)
	}

	async runEffect(effectId: number, fixtureIds: number[]): Promise<void> {
		await this.fetch('/api/effects/run', {
			method: 'POST',
			body: JSON.stringify({ effectId, fixtureIds }),
		})
		await this.syncState()
	}

	async stopEffects(slot?: string): Promise<void> {
		await this.fetch('/api/effects/stop', {
			method: 'POST',
			body: JSON.stringify(slot ? { slot } : {}),
		})
		await this.syncState()
	}

	async toggleColorPushMode(): Promise<void> {
		const res = await this.fetch<{ pushMode?: boolean; holdMode?: boolean }>('/api/companion/color-mode', {
			method: 'POST',
			body: JSON.stringify({ toggle: true }),
		})
		this.state.colorPushMode = !!(res.pushMode ?? res.holdMode)
		this.log('info', `Color input mode → ${this.state.colorPushMode ? 'PUSH' : 'TOGGLE'}`)
		this.notify()
	}

	async releaseColor(): Promise<void> {
		await this.fetch('/api/companion/color-release', { method: 'POST', body: '{}' })
	}

	async trigger(
		action_type: string,
		action_data: Record<string, unknown> = {},
		mode: string = 'momentary',
		key?: string,
	): Promise<void> {
		this.log('info', `Trigger ${action_type} mode=${mode} ${JSON.stringify(action_data)}`)
		const body: Record<string, unknown> = { action_type, action_data, mode }
		if (key) body.key = key
		await this.fetch('/api/companion/trigger', {
			method: 'POST',
			body: JSON.stringify(body),
		})
		if (action_type === 'effect' || action_type === 'color') {
			await this.syncState()
		}
	}

	resolveEffectId(effectIdRaw: string | number | undefined, effectName?: string): number {
		const name = effectName?.trim()
		if (name) {
			const exact = this.effects.find((e) => e.name === name)
			if (exact) return exact.id
			const norm = normalizeEffectName(name)
			const normalized = this.effects.find((e) => normalizeEffectName(e.name) === norm)
			if (normalized) return normalized.id
			const loose = this.effects.find((e) => normalizeEffectName(e.name).includes(norm))
			if (loose) return loose.id
		}
		const id = Number(effectIdRaw)
		if (Number.isFinite(id) && id > 0) {
			const byId = this.effects.find((e) => e.id === id)
			if (byId) return byId.id
		}
		throw new Error(`Effect not found: ${name || effectIdRaw || '(empty)'}`)
	}

	/** Run/stop via /api/effects/run — same path as the touch UI. */
	async runEffectWithMode(
		effectId: number,
		target: string,
		groupId: string,
		mode: string,
	): Promise<void> {
		const effect = this.effects.find((e) => e.id === effectId)
		if (!effect) throw new Error(`Effect id ${effectId} not found`)

		const slot = effectSlotForType(effect.type)
		await this.syncState()

		if (mode === 'toggle') {
			const running = this.state.effectSlots[slot]
			if (running && running.effectId === effectId) {
				await this.stopEffects(slot)
				return
			}
		} else if (mode === 'off') {
			const running = this.state.effectSlots[slot]
			if (running) await this.stopEffects(slot)
			return
		}

		const fixtureIds = this.resolveFixtureIdsForEffect(effect, target, groupId)
		if (!fixtureIds.length) {
			throw new Error('No fixtures match this effect — check mirror ball patches or group selection')
		}
		await this.runEffect(effectId, fixtureIds)
	}

	resolveFixtureIds(target: string, groupId: string): number[] {
		if (target === 'group') {
			const group = this.groups.find((g) => String(g.id) === groupId)
			return group?.fixture_ids || []
		}
		return this.fixtures.map((f) => f.id)
	}

	isMirrorBallFixture(f: FixtureRow): boolean {
		if (f.category === 'mirror_ball') return true
		const label = String(f.type_name || f.name || '').toLowerCase()
		if (/strato|stratosphere|mirror ball|disco ball/.test(label)) return true
		const ch = f.channels || []
		const isMover = ch.some((c) => c.type === 'pan') && ch.some((c) => c.type === 'tilt')
		if (isMover) return false
		return ch.some((c) => c.type === 'motor') && ch.some((c) => c.type === 'red')
	}

	resolveFixtureIdsForEffect(effect: EffectRow, target: string, groupId: string): number[] {
		let ids = this.resolveFixtureIds(target, groupId)
		const mirrorEffect =
			effect.fixture_target === 'mirror_ball' || MIRROR_BALL_EFFECT_TYPES.has(effect.type)
		if (mirrorEffect) {
			ids = ids.filter((id) => {
				const f = this.fixtures.find((x) => x.id === id)
				return f && this.isMirrorBallFixture(f)
			})
		} else if (effect.fixture_target === 'moving_head') {
			ids = ids.filter((id) => {
				const f = this.fixtures.find((x) => x.id === id)
				const ch = f?.channels || []
				return ch.some((c) => c.type === 'pan') && ch.some((c) => c.type === 'tilt')
			})
		}
		return ids
	}

	sceneChoices(): Choice[] {
		return this.scenes.map((s) => ({ id: String(s.id), label: s.name }))
	}

	effectChoices(): Choice[] {
		return this.effects.map((e) => ({ id: String(e.id), label: `${e.name} (${e.type})` }))
	}

	groupChoices(): Choice[] {
		return this.groups.map((g) => ({ id: String(g.id), label: g.name }))
	}

	sequenceChoices(): Choice[] {
		return this.sequences.map((s) => ({ id: String(s.id), label: s.name }))
	}
}
