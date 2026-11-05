// Application-level error taxonomy. The UI shows `message` verbatim, so the
// messages come from the i18n catalog (libT) at throw time.

export class PipelineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PipelineError'
  }
}

export class ModelsNotReadyError extends PipelineError {
  constructor(message: string) {
    super(message)
    this.name = 'ModelsNotReadyError'
  }
}

export class InvalidParameterError extends PipelineError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidParameterError'
  }
}

export class AudioError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioError'
  }
}

/** Nothing was heard (silence, noise or a Whisper hallucination) — a calm notice, not an error. */
export class EmptyAudioError extends AudioError {
  constructor(message: string) {
    super(message)
    this.name = 'EmptyAudioError'
  }
}

export class BadAudioError extends AudioError {
  constructor(message: string) {
    super(message)
    this.name = 'BadAudioError'
  }
}

export class AsrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsrError'
  }
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmError'
  }
}

export class LlmNotSupportedError extends LlmError {
  constructor(message: string) {
    super(message)
    this.name = 'LlmNotSupportedError'
  }
}

export class SpeechError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpeechError'
  }
}

export class DriveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriveError'
  }
}
