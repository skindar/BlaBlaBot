// Brain router: local WebLLM or a cloud endpoint. The rest of the app sees
// one BrainPort; switching the brain is a configuration change, not a code
// path.

import type { BrainInfo, BrainPort } from '../../application/ports'
import { LlmError } from '../../application/errors'
import type { BrainKind, LlmCallOptions, LlmMessage, LlmReply } from '../../domain/models'
import { cloudChat, type CloudConfig } from './cloudChat'
import { llmModelByKey, contextWindowFor } from './catalog'
import type { WebLlmEngine } from './webLlmEngine'

export interface BrainConfig {
  kind: BrainKind
  llmKey: string
  cloud: CloudConfig
}

export class BrainRouter implements BrainPort {
  private config: BrainConfig = { kind: 'local', llmKey: 'gemma-3-1b', cloud: { baseUrl: '', apiKey: '', model: '' } }

  constructor(private readonly local: WebLlmEngine) {}

  configure(config: BrainConfig): void {
    this.config = config
  }

  get kind(): BrainKind {
    return this.config.kind
  }

  get modelKey(): string {
    return this.kind === 'cloud' ? 'cloud' : this.config.llmKey
  }

  get modelId(): string {
    return this.kind === 'cloud' ? this.config.cloud.model || 'cloud-model' : llmModelByKey(this.config.llmKey).modelId
  }

  get tiny(): boolean {
    if (this.kind === 'cloud') return false
    return Boolean(llmModelByKey(this.config.llmKey).tiny)
  }

  get device(): string {
    return this.kind === 'cloud' ? `Cloud · ${this.modelId}` : this.local.deviceLabel
  }

  get promptBudget(): number {
    return this.kind === 'cloud' ? 8192 : contextWindowFor(this.config.llmKey).promptBudget
  }

  info(): BrainInfo {
    return {
      kind: this.kind,
      modelKey: this.modelKey,
      modelId: this.modelId,
      tiny: this.tiny,
      device: this.device,
      promptBudget: this.promptBudget,
    }
  }

  isReady(): boolean {
    if (this.kind === 'cloud') return true
    return this.local.loadedKey === this.config.llmKey
  }

  chat = async (messages: LlmMessage[], opts: LlmCallOptions = {}): Promise<LlmReply> => {
    if (this.kind === 'cloud') return cloudChat(this.config.cloud, messages, opts)
    if (this.local.loadedKey === null) throw new LlmError('local model is not loaded')
    return this.local.chat(messages, opts)
  }
}
