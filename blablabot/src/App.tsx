import { useState } from "react"

const A = "/assets"

const icons = {
  logo: `${A}/60584.svg`,
  messages: `${A}/14c6a.svg`,
  layers: `${A}/4c715.svg`,
  book: `${A}/e51f5.svg`,
  plus: `${A}/096cb.svg`,
  sprout: `${A}/ee296.svg`,
  settings: `${A}/55f7e.svg`,
  dot: `${A}/36492.svg`,
  globe: `${A}/0c2c6.svg`,
  chevron: `${A}/3bcec.svg`,
  bot: `${A}/73268.svg`,
  volume: `${A}/5da31.svg`,
  languages: `${A}/6fdcb.svg`,
  checks: `${A}/281f0.svg`,
  bookmark: `${A}/ef748.svg`,
  bulb: `${A}/84180.svg`,
  mic: `${A}/d15cb.svg`,
  toggle: `${A}/ae74d.svg`,
  info: `${A}/0ba15.svg`,
  keyboard: `${A}/6fb16.svg`,
  panel: `${A}/96897.svg`,
  compass: `${A}/abb2a.svg`,
  waves: `${A}/13225.svg`,
  sun: `${A}/cc2ae.svg`,
  shuffle: `${A}/b76c3.svg`,
  sparkles: `${A}/e9153.svg`,
  smallPlus: `${A}/63739.svg`,
  chart: `${A}/60890.svg`,
  smallChevron: `${A}/16181.svg`,
  audio: `${A}/ded78.svg`,
  smallBook: `${A}/4ed56.svg`,
}

type IconName = keyof typeof icons

function Icon({
  name,
  size = 16,
  className = "",
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <img
      alt=""
      className={`block shrink-0 ${className}`}
      height={size}
      src={icons[name]}
      width={size}
    />
  )
}

function BotMark({ large = false }: { large?: boolean }) {
  const size = large ? 32 : 30
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-[#526f60]"
      style={{ height: size, width: size }}
    >
      <Icon name={large ? "logo" : "bot"} size={large ? 20 : 18} />
    </span>
  )
}

function MessageAction({
  icon,
  children,
  active,
  onClick,
}: {
  icon: IconName
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className={`flex items-center gap-1.5 text-xs transition-colors hover:text-[#526f60] ${
        active ? "text-[#526f60]" : "text-[#737970]"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} size={15} />
      <span>{children}</span>
    </button>
  )
}

function CompanionMessage({
  time,
  children,
  save = false,
}: {
  time: string
  children: React.ReactNode
  save?: boolean
}) {
  const [translated, setTranslated] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [saved, setSaved] = useState(false)

  return (
    <div className="flex w-full items-start gap-3.5">
      <BotMark />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-xs text-[#526f60]">
          BlaBlaBot{" "}
          <span className="font-normal text-[#94988f]"> · {time}</span>
        </p>
        <p className="mt-3.5 text-[18px] leading-[1.65] text-[#292e2a]">
          {children}
        </p>
        {translated && (
          <p className="mt-2 rounded-lg bg-[#f1f0eb] px-3 py-2 text-sm leading-relaxed text-[#737970]">
            Victoria, imagine que tienes todo un fin de semana libre. ¿Adónde te
            gustaría ir?
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-5">
          <MessageAction
            active={playing}
            icon="volume"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? "Playing…" : "Listen"}
          </MessageAction>
          <MessageAction
            active={translated}
            icon="languages"
            onClick={() => setTranslated(!translated)}
          >
            {translated ? "Hide translation" : "Translate"}
          </MessageAction>
          {save && (
            <MessageAction
              active={saved}
              icon="bookmark"
              onClick={() => setSaved(!saved)}
            >
              {saved ? "Phrase saved" : "Save phrase"}
            </MessageAction>
          )}
        </div>
      </div>
    </div>
  )
}

const topics = [
  [
    "A weekend away",
    "Little adventures, new places, and your idea of a perfect day.",
  ],
  [
    "A perfect morning",
    "Small rituals, favorite flavors, and an unhurried start.",
  ],
  [
    "A place to return to",
    "Familiar streets, fond memories, and what makes somewhere feel like home.",
  ],
]

const phrases = [
  ["off the beaten track", "somewhere less well-known"],
  ["a change of scenery", "a break from familiar places"],
  ["take it easy", "relax and slow down"],
]

export default function App() {
  const [activeNav, setActiveNav] = useState("Conversation")
  const [rightPanel, setRightPanel] = useState(true)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [topicIndex, setTopicIndex] = useState(0)
  const [savedPhrases, setSavedPhrases] = useState<string[]>([])
  const [handsFree, setHandsFree] = useState(false)
  const [typing, setTyping] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [draft, setDraft] = useState("")
  const [ended, setEnded] = useState(false)
  const [level, setLevel] = useState("B1 · Intermediate")
  const [voice, setVoice] = useState("Emily · British English")

  const savePhrase = (phrase: string) => {
    setSavedPhrases((current) =>
      current.includes(phrase)
        ? current.filter((item) => item !== phrase)
        : [...current, phrase],
    )
  }

  if (ended) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#faf9f6] p-6">
        <section className="w-full max-w-md rounded-[24px] border border-[#e5e6de] bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-6 flex w-fit">
            <BotMark large />
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.6px] text-[#292e2a]">
            A lovely conversation
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#737970]">
            Your conversation has been saved in your diary. Come back whenever
            you feel like talking.
          </p>
          <button
            className="mt-7 rounded-full bg-[#526f60] px-6 py-3 text-sm text-white hover:bg-[#466052]"
            onClick={() => setEnded(false)}
            type="button"
          >
            Return to conversation
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh bg-[#faf9f6] text-[#292e2a]">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col justify-between overflow-y-auto border-r border-[#e5e6de] bg-[#f1f0eb] px-4 pb-5 pt-8 lg:flex">
        <div>
          <div className="flex items-center gap-[9px] pl-2">
            <BotMark large />
            <span className="text-xl tracking-[-0.7px]">BlaBlaBot</span>
          </div>

          <nav className="mt-8 space-y-[5px]" aria-label="Primary navigation">
            {[
              ["Conversation", "messages"],
              ["Cards", "layers"],
              ["Diary", "book"],
            ].map(([label, icon]) => (
              <button
                className={`flex h-[46px] w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
                  activeNav === label
                    ? "bg-[#e5ece4] font-semibold text-[#526f60]"
                    : "text-[#737970] hover:bg-[#e9e9e3]"
                }`}
                key={label}
                onClick={() => setActiveNav(label)}
                type="button"
              >
                <Icon name={icon as IconName} size={20} />
                <span className="flex-1 text-left">{label}</span>
                {label === "Cards" && (
                  <span className="text-xs font-normal">12</span>
                )}
              </button>
            ))}
          </nav>

          <section className="mt-8 px-3">
            <h2 className="text-[11px] font-semibold tracking-[1px] text-[#94988f]">
              RECENT CONVERSATIONS
            </h2>
            <button className="mt-[18px] block w-full text-left" type="button">
              <span className="block text-[13px]">A weekend away</span>
              <span className="mt-1.5 block text-[11px] text-[#737970]">
                Today · In progress
              </span>
            </button>
            <button
              className="mt-[18px] block w-full text-left text-[#737970]"
              type="button"
            >
              <span className="block text-[13px]">Getting to know you</span>
              <span className="mt-1.5 block text-[11px] text-[#94988f]">
                Yesterday
              </span>
            </button>
            <button
              className="mt-[18px] flex items-center gap-[7px] text-xs text-[#526f60]"
              type="button"
            >
              <Icon name="plus" size={15} />
              New conversation
            </button>
          </section>
        </div>

        <div>
          <section className="rounded-xl bg-[#faf9f6] p-4">
            <div className="flex items-center gap-2">
              <Icon name="sprout" size={18} />
              <h2 className="text-[13px] font-semibold">A little every day</h2>
            </div>
            <p className="mt-2.5 text-xs leading-[1.5] text-[#737970]">
              You’ve made time to talk 3 days this week. Keep going.
            </p>
            <div className="mt-2.5 flex justify-between">
              {"MTWTFSS".split("").map((day, index) => (
                <div
                  className="flex flex-col items-center gap-[7px]"
                  key={`${day}-${index}`}
                >
                  <span
                    className={`h-1 w-4 rounded-sm ${
                      index < 3 ? "bg-[#526f60]" : "bg-[#e5e6de]"
                    }`}
                  />
                  <span className="text-[9px] text-[#94988f]">{day}</span>
                </div>
              ))}
            </div>
          </section>
          <button
            className="mt-5 flex w-full items-center gap-2.5 px-2 text-left"
            type="button"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e5e6de] text-[13px] font-semibold text-[#526f60]">
              V
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">Victoria</span>
              <span className="mt-[3px] block text-[11px] text-[#737970]">
                Your learning space
              </span>
            </span>
            <Icon name="settings" size={18} />
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-24 items-center justify-between border-b border-[#e5e6de] px-5 sm:px-8 xl:px-10">
          <div>
            <h1 className="text-[23px] font-semibold tracking-[-0.6px]">
              English conversation
            </h1>
            <div className="mt-[7px] flex items-center gap-1.5">
              <Icon name="dot" size={5} />
              <p className="text-xs text-[#737970]">
                A space to talk, not to be perfect.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            {!rightPanel && (
              <button
                aria-label="Open inspiration panel"
                className="hidden rounded-lg border border-[#e5e6de] p-2 xl:block"
                onClick={() => setRightPanel(true)}
                type="button"
              >
                <Icon name="sparkles" size={16} />
              </button>
            )}
            <div className="relative">
              <button
                className="flex items-center gap-2 rounded-lg border border-[#e5e6de] px-3 py-[9px] text-xs font-medium"
                onClick={() => setLanguageOpen(!languageOpen)}
                type="button"
              >
                <Icon name="globe" size={16} />
                <span className="hidden sm:inline">English</span>
                <Icon name="chevron" size={13} />
              </button>
              {languageOpen && (
                <div className="absolute right-0 top-11 z-20 w-36 rounded-xl border border-[#e5e6de] bg-white p-1.5 text-xs shadow-lg">
                  {["English", "Spanish", "French"].map((language) => (
                    <button
                      className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#f1f0eb]"
                      key={language}
                      onClick={() => setLanguageOpen(false)}
                      type="button"
                    >
                      {language}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="whitespace-nowrap text-xs font-medium text-[#737970] hover:text-[#292e2a]"
              onClick={() => setEnded(true)}
              type="button"
            >
              End session
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div className="mx-auto w-full max-w-[896px] px-5 pb-8 pt-[29px] sm:px-8 xl:px-11">
              <div className="flex items-center gap-3.5">
                <span className="h-px flex-1 bg-[#e5e6de]" />
                <span className="text-[11px] text-[#94988f]">
                  Today, November 3
                </span>
                <span className="h-px flex-1 bg-[#e5e6de]" />
              </div>

              <div className="mt-8 space-y-8">
                <CompanionMessage time="10:24">
                  Hi Victoria! Let’s imagine you have a whole weekend free.
                  Where would you like to go — somewhere familiar, or somewhere
                  completely new?
                </CompanionMessage>

                <div className="flex flex-col items-end gap-[9px]">
                  <div className="w-full max-w-[588px] rounded-bl-[20px] rounded-br-[5px] rounded-t-[20px] bg-[#ebefe7] px-[22px] py-[18px]">
                    <p className="text-[17px] leading-[1.6]">
                      I’d love to visit a small town by the sea. Maybe find a
                      nice café and just slow down for a couple of days.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[#94988f]">
                    <span>You · 10:25</span>
                    <Icon name="checks" size={14} />
                  </div>
                </div>

                <CompanionMessage save time="10:26">
                  That sounds like a lovely way to recharge. A little sea air, a
                  good coffee, and no rush! What would your ideal first morning
                  there look like?
                </CompanionMessage>

                <button
                  className="ml-0 flex flex-wrap items-center gap-2 text-xs sm:ml-11"
                  onClick={() => {
                    setTyping(true)
                    setDraft("I’d probably start with…")
                  }}
                  type="button"
                >
                  <Icon name="bulb" size={15} />
                  <span className="text-[#737970]">Need a starting point?</span>
                  <span className="font-medium text-[#526f60]">
                    “I’d probably start with…”
                  </span>
                </button>
              </div>
            </div>

            <div className="mx-auto w-full max-w-[896px] px-5 pb-[26px] pt-[22px] sm:px-8 xl:px-11">
              <div className="rounded-[20px] border border-[#e5e6de] bg-white px-[22px] py-5">
                {typing ? (
                  <div className="flex items-end gap-3">
                    <textarea
                      autoFocus
                      className="min-h-14 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-[#94988f]"
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Type your answer…"
                      value={draft}
                    />
                    <button
                      className="rounded-full bg-[#526f60] px-5 py-3 text-sm text-white disabled:opacity-40"
                      disabled={!draft.trim()}
                      onClick={() => {
                        setDraft("")
                        setTyping(false)
                      }}
                      type="button"
                    >
                      Send
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[15px]">
                        {speaking ? "We’re listening…" : "Your turn, Victoria"}
                      </p>
                      <p className="mt-[7px] text-xs text-[#737970]">
                        {speaking
                          ? "Speak naturally and take your time."
                          : "Take your time. We’re listening."}
                      </p>
                    </div>
                    <button
                      className={`flex h-14 shrink-0 items-center gap-[11px] rounded-full px-[23px] text-[15px] text-white transition-colors ${
                        speaking
                          ? "bg-[#9c625c]"
                          : "bg-[#526f60] hover:bg-[#466052]"
                      }`}
                      onClick={() => setSpeaking(!speaking)}
                      type="button"
                    >
                      <Icon name="mic" size={22} />
                      <span className="hidden sm:inline">
                        {speaking ? "Stop speaking" : "Start speaking"}
                      </span>
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-[18px] flex flex-wrap items-center justify-between gap-3 px-1">
                <button
                  className="flex items-center gap-2 text-xs text-[#737970]"
                  onClick={() => setHandsFree(!handsFree)}
                  type="button"
                >
                  {handsFree ? (
                    <span className="flex h-[18px] w-[30px] items-center justify-end rounded-full bg-[#526f60] p-0.5">
                      <span className="size-3.5 rounded-full bg-white" />
                    </span>
                  ) : (
                    <Icon
                      className="h-[18px] w-[30px]"
                      name="toggle"
                      size={18}
                    />
                  )}
                  Hands-free
                  <Icon name="info" size={13} />
                </button>
                <div className="hidden items-center gap-1.5 text-[11px] text-[#94988f] sm:flex">
                  <span>or hold</span>
                  <kbd className="rounded border border-[#e5e6de] px-[7px] py-[3px] text-[10px] text-[#737970]">
                    Space
                  </kbd>
                  <span>to talk</span>
                </div>
                <button
                  className="flex items-center gap-[7px] text-xs text-[#737970]"
                  onClick={() => setTyping(!typing)}
                  type="button"
                >
                  <Icon name="keyboard" size={16} />
                  {typing ? "Use voice" : "Type instead"}
                </button>
              </div>
              <p className="mt-[18px] text-center text-[11px] text-[#94988f]">
                Just a conversation. No pressure, no perfect answers.
              </p>
            </div>
          </div>

          {rightPanel && (
            <aside className="sticky top-24 hidden h-[calc(100dvh-6rem)] w-80 shrink-0 flex-col justify-between overflow-y-auto border-l border-[#e5e6de] px-6 pb-7 pt-8 xl:flex">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    A little inspiration
                  </h2>
                  <button
                    aria-label="Close inspiration panel"
                    onClick={() => setRightPanel(false)}
                    type="button"
                  >
                    <Icon name="panel" size={17} />
                  </button>
                </div>

                <section className="mt-[27px] rounded-[20px] bg-[#f0f2e9] p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-semibold tracking-[1.2px] text-[#526f60]">
                      TODAY’S TOPIC
                    </h3>
                    <Icon name="compass" size={19} />
                  </div>
                  <p className="mt-4 text-[22px] leading-[1.25] tracking-[-0.6px]">
                    {topics[topicIndex][0]}
                  </p>
                  <p className="mt-4 text-xs leading-[1.6] text-[#737970]">
                    {topics[topicIndex][1]}
                  </p>
                  <div className="mt-3 flex h-[43px] items-center gap-3">
                    <img alt="" className="h-[35px] w-40" src={icons.waves} />
                    <Icon name="sun" size={25} />
                  </div>
                  <button
                    className="mt-3 flex items-center gap-[7px] text-xs text-[#526f60]"
                    onClick={() =>
                      setTopicIndex((topicIndex + 1) % topics.length)
                    }
                    type="button"
                  >
                    <Icon name="shuffle" size={14} />
                    Explore another topic
                  </button>
                </section>

                <section className="mt-[27px]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px]">Words to try</h3>
                    <Icon name="sparkles" size={15} />
                  </div>
                  <div className="mt-[17px] space-y-[17px]">
                    {phrases.map(([phrase, meaning]) => {
                      const saved = savedPhrases.includes(phrase)
                      return (
                        <div className="flex items-center gap-2.5" key={phrase}>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-[#526f60]">
                              {phrase}
                            </p>
                            <p className="mt-[5px] text-[11px] leading-[1.45] text-[#737970]">
                              {meaning}
                            </p>
                          </div>
                          <button
                            aria-label={`${
                              saved ? "Remove" : "Save"
                            } ${phrase}`}
                            className={`rounded-full transition-colors ${
                              saved ? "bg-[#dce7db]" : ""
                            }`}
                            onClick={() => savePhrase(phrase)}
                            type="button"
                          >
                            <Icon
                              className={saved ? "rotate-45" : ""}
                              name="smallPlus"
                              size={15}
                            />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-[17px] text-[10px] leading-[1.5] text-[#94988f]">
                    Tap + to keep a phrase in your cards.
                  </p>
                </section>
              </div>

              <section className="mt-10 border-t border-[#e5e6de] pt-5">
                <h3 className="text-[10px] font-semibold tracking-[1.1px] text-[#94988f]">
                  MAKE IT YOURS
                </h3>
                <button
                  className="mt-5 flex w-full items-center gap-2.5 text-left"
                  onClick={() =>
                    setLevel(
                      level === "B1 · Intermediate"
                        ? "B2 · Upper intermediate"
                        : "B1 · Intermediate",
                    )
                  }
                  type="button"
                >
                  <Icon name="chart" size={17} />
                  <span className="flex-1">
                    <span className="block text-[11px] text-[#737970]">
                      Conversation level
                    </span>
                    <span className="mt-[5px] block text-[13px] font-medium">
                      {level}
                    </span>
                  </span>
                  <Icon name="smallChevron" size={14} />
                </button>
                <button
                  className="mt-5 flex w-full items-center gap-2.5 text-left"
                  onClick={() =>
                    setVoice(
                      voice === "Emily · British English"
                        ? "Maya · American English"
                        : "Emily · British English",
                    )
                  }
                  type="button"
                >
                  <Icon name="audio" size={17} />
                  <span className="flex-1">
                    <span className="block text-[11px] text-[#737970]">
                      Companion voice
                    </span>
                    <span className="mt-[5px] block text-[13px] font-medium">
                      {voice}
                    </span>
                  </span>
                  <Icon name="smallChevron" size={14} />
                </button>
                <div className="mt-5 flex items-start gap-2 text-[11px] leading-[1.5] text-[#737970]">
                  <Icon name="smallBook" size={14} />
                  <p>Your conversation will be saved in your diary.</p>
                </div>
              </section>
            </aside>
          )}
        </div>
      </section>
    </main>
  )
}
