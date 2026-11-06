// Composition root: the only place where concrete adapters are wired to the
// application services. Tests build services directly with fakes; the app
// builds them here.

import { isWebSpeechAsrSupported } from '../shared/platform'
import { BrainRouter } from '../infrastructure/llm/brainRouter'
import { DEFAULT_LLM_KEY, availableLlmModels, contextWindowFor, isKnownLlmKey, llmModelByKey } from '../infrastructure/llm/catalog'
import { WebLlmEngine } from '../infrastructure/llm/webLlmEngine'
import { ASR_MODELS, DEFAULT_ASR_KEY, TransformersAsrEngine } from '../infrastructure/asr/transformersAsr'
import { OfflineDictionary } from '../infrastructure/dictionary/offlineDictionary'
import { BUILT_IN_CLIENT_ID, GoogleDriveClient } from '../infrastructure/drive/googleDrive'
import { BenchRecorder } from '../infrastructure/telemetry/benchRecorder'
import { PhononEngine } from '../infrastructure/tts/phononTts'
import { PiperEngine } from '../infrastructure/tts/piperTts'
import { SpeechRouter } from '../infrastructure/tts/speechRouter'
import { TtsEngine } from '../infrastructure/tts/systemTts'
import {
  LocalAchievementsRepository,
  LocalActivityRepository,
  LocalConversationRepository,
  LocalDiaryRepository,
  LocalOnboardingRepository,
  LocalSessionRepository,
  LocalSettingsRepository,
  LocalStorageKeyValue,
  LocalVocabularyRepository,
  SequentialIdSource,
  SystemClock,
} from '../infrastructure/storage/repositories'
import { AchievementsService } from '../application/services/AchievementsService'
import { DiaryService } from '../application/services/DiaryService'
import { ModelManager } from '../application/services/ModelManager'
import { SettingsService } from '../application/services/SettingsService'
import { SyncService } from '../application/services/SyncService'
import { TurnService } from '../application/services/TurnService'
import { VocabularyService } from '../application/services/VocabularyService'
import { EventBus } from '../application/support/EventBus'
import { defaultSettings } from '../domain/policies/settings'
import type { UiLang } from '../domain/models'
import type { AppServices } from '../presentation/context'

function detectUiLang(): UiLang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export function createContainer(): AppServices {
  const clock = new SystemClock()
  const store = new LocalStorageKeyValue()
  const bus = new EventBus()
  const ids = new SequentialIdSource(store, clock)

  const defaults = (): ReturnType<typeof defaultSettings> =>
    defaultSettings(detectUiLang(), { llmModel: DEFAULT_LLM_KEY, asrModel: DEFAULT_ASR_KEY })

  const settingsRepo = new LocalSettingsRepository(store, defaults)
  const settings = new SettingsService(settingsRepo, defaults, isKnownLlmKey)

  const conversation = new LocalConversationRepository(store, bus, clock, ids)
  const vocab = new LocalVocabularyRepository(store, bus, clock, ids)
  const diaryRepo = new LocalDiaryRepository(store, bus, clock, ids)
  const sessions = new LocalSessionRepository(store)
  const activity = new LocalActivityRepository(store, bus, clock)
  const achievementsRepo = new LocalAchievementsRepository(store)
  const achievements = new AchievementsService({
    activity,
    conversation,
    diary: diaryRepo,
    vocab,
    sessions,
    achievements: achievementsRepo,
    bus,
  })
  const onboarding = new LocalOnboardingRepository(store)
  const dictionary = new OfflineDictionary()

  const llm = new WebLlmEngine()
  const brain = new BrainRouter(llm)
  const asr = new TransformersAsrEngine()
  const speech = new SpeechRouter(new PhononEngine(), new TtsEngine(), new PiperEngine())
  const drive = new GoogleDriveClient()
  const catalog = {
    llmModels: () => availableLlmModels(),
    llmModel: (key: string) => llmModelByKey(key),
    asrModels: () => ASR_MODELS,
    defaultAsrKey: DEFAULT_ASR_KEY,
    webgpuSupported: () => WebLlmEngine.supported(),
    googleClientId: BUILT_IN_CLIENT_ID,
  }

  const bench = new BenchRecorder({
    store,
    clock,
    localChat: (messages, opts) => llm.chat(messages, opts),
    ensureModel: (key, onProgress) => llm.ensure(key, onProgress),
    loadedModelKey: () => llm.loadedKey,
    deviceLabel: () => llm.deviceLabel,
    catalog: {
      byKey: key => llmModelByKey(key),
      contextWindowFor: key => contextWindowFor(key),
    },
  })

  const turns = new TurnService({
    brain,
    asr,
    speech,
    conversation,
    diary: diaryRepo,
    sessions,
    activity,
    dictionary,
    telemetry: bench,
    clock,
  })

  const vocabulary = new VocabularyService({ brain, vocab, dictionary, telemetry: bench, clock })
  const diary = new DiaryService({ diary: diaryRepo, turns, clock })

  const sync = new SyncService(drive, conversation, vocab, diaryRepo, activity, bus)

  const configureBrain = (settings: import('../domain/models').Settings): void => {
    brain.configure({
      kind: settings.brain,
      llmKey: settings.llmModel,
      cloud: {
        baseUrl: settings.cloudBaseUrl,
        apiKey: settings.cloudApiKey,
        model: settings.cloudModel,
      },
    })
  }
  configureBrain(settings.get())

  const models = new ModelManager({
    llm,
    asr,
    speech,
    telemetry: bench,
    clock,
    configureBrain,
    brainKind: s => s.brain,
    llmLabel: key => llmModelByKey(key).label,
    asrDevice: () => (asr.device === 'webgpu' ? 'WebGPU' : 'WASM'),
    systemAsrAvailable: isWebSpeechAsrSupported,
  })

  let started = false
  const start = (): void => {
    if (started) return
    started = true
    sync.start()
    // subscribe() fires immediately with the current settings → initial load
    settings.subscribe(current => {
      configureBrain(current)
      models.apply(current)
      sync.configure({ autoSync: current.driveAutoSync })
    })
  }

  return {
    settings,
    models,
    turns,
    vocabulary,
    diary,
    achievements,
    bench,
    sync,
    conversation,
    vocab,
    diaryRepo,
    sessions,
    activity,
    achievementsRepo,
    onboarding,
    speech,
    catalog,
    bus,
    start,
  }
}
