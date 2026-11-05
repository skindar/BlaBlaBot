// Free-talk hygiene: small models are heavily assistant-tuned and keep
// offering "how can I help you?" even when told to be a friend.
// Prompting alone is not enough (measured on Qwen2.5-1.5B/3B), so the reply
// gets a deterministic last line of defence: drop the customer-support
// sentence, keep the natural part.

const ASSISTANT_OFFER_RE =
  /(?:(?:как|чем)\s+(?:я\s+)?(?:могу|может)\s+(?:(?:вам|тебе)\s+)?(?:помочь|помогать|быть\s+полезн)|(?:я\s+)?могу\s+[^.!?]{0,24}?помочь|(?:я\s+)?готов[а]?\s+помочь|обращайтесь|рад[а]?\s+помочь|how\s+(?:can|may|could)\s+i\s+(?:help|assist)|happy\s+to\s+help|let\s+me\s+know\s+if|извините\s+за\s+путаницу|извини\s+за\s+путаницу|прошу\s+прощения|может,?\s+расскажу\s+больше|расскажу\s+больше\s*\?|я\s+здесь,?\s+чтобы\s+помочь|если\s+(?:у\s+тебя|у\s+вас)\s+есть\s+вопросы)/i

/** Does this sentence sound like customer support rather than a friend? */
export function hasAssistantOffer(text: string): boolean {
  return ASSISTANT_OFFER_RE.test(text)
}

/** Remove assistant-offer sentences; returns the remaining natural text. */
export function stripAssistantOffers(text: string): string {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
  return sentences.filter(s => !hasAssistantOffer(s)).join(' ').trim()
}

/** Last-resort reply when the model produced nothing but an assistant offer. */
export function freeTalkFallback(targetLang: 'ru' | 'en' | 'de' | 'fr' | 'es' | 'pt'): string {
  switch (targetLang) {
    case 'ru':
      return 'Понятно. А у тебя как дела?'
    case 'de':
      return 'Verstehe. Und wie geht es dir?'
    case 'fr':
      return 'Je vois. Et toi, comment ça va ?'
    case 'es':
      return 'Ya veo. ¿Y tú cómo estás?'
    case 'pt':
      return 'Entendi. E você, como está?'
    default:
      return 'I see. How are you doing?'
  }
}


/** Compare two assistant replies ignoring case, wrapping quotes and
 *  whitespace. A small model sometimes repeats its previous answer verbatim
 *  when the user corrects it — that is worse than a short fallback. */
export function sameAssistantReply(a: string, b: string): boolean {
  const norm = (text: string) =>
    text
      .toLowerCase()
      .replace(/[«»"'“”„]/g, '')
      .replace(/[.!?…]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  return norm(a) === norm(b)
}
