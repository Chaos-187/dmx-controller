import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, RefreshVariables, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import type { FeedbacksSchema } from './feedbacks.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { DmxControllerClient } from './api.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	client: DmxControllerClient | null = null

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, _secrets: undefined): Promise<void> {
		this.config = config
		await this.connectClient()
	}

	async destroy(): Promise<void> {
		this.client?.destroy()
		this.client = null
	}

	async configUpdated(config: ModuleConfig, _secrets: undefined): Promise<void> {
		this.config = config
		this.client?.destroy()
		this.client = null
		await this.connectClient()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	checkAllFeedbacks(): void {
		const ids: (keyof FeedbacksSchema)[] = [
			'dmx_output_on',
			'blackout_active',
			'scene_active',
			'fixture_enabled',
			'vdj_connected',
			'effect_slot_running',
			'color_toggle_mode',
			'color_push_mode',
			'sequence_playing',
		]
		for (const id of ids) this.checkFeedbacks(id)
	}

	private async connectClient(): Promise<void> {
		this.updateStatus(InstanceStatus.Connecting)

		const client = new DmxControllerClient(this.config.host, this.config.port)
		client.onLog = (level, message) => this.log(level, message)
		client.onChange = () => {
			RefreshVariables(this)
			this.checkAllFeedbacks()
		}
		client.onConnectionChange = (connected) => {
			if (connected) {
				this.updateStatus(InstanceStatus.Ok)
				this.updateActions()
				this.updateFeedbacks()
				this.updatePresets()
				this.updateVariableDefinitions()
				RefreshVariables(this)
				this.checkAllFeedbacks()
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, 'DMX Controller unreachable — retrying')
			}
		}

		this.client = client
		await client.start()
	}
}
