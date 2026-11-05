// Design-system primitives of the BlaBlaBot look (the Figma Make design):
// the icon set, the bot mark and small shared pieces. Asset paths must stay
// relative to the deployment base (GitHub Pages lives in a subpath).

const A = `${import.meta.env.BASE_URL}assets`

export const icons = {
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
} as const

export type IconName = keyof typeof icons

export function Icon({
  name,
  size = 16,
  className = '',
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

export function BotMark({ large = false }: { large?: boolean }) {
  const size = large ? 32 : 30
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-[#526f60]"
      style={{ height: size, width: size }}
    >
      <Icon name={large ? 'logo' : 'bot'} size={large ? 20 : 18} />
    </span>
  )
}

/** The design's sage pill button */
export function SageButton({
  children,
  onClick,
  disabled,
  className = '',
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      className={`rounded-full bg-[#526f60] px-6 py-3 text-sm text-white transition-colors hover:bg-[#466052] disabled:opacity-40 ${className}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  )
}
