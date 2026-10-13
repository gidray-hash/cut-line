import type { AdvicePlayer, ManagerAdvice } from "@/lib/types"

export const EMPTY_LINEUP = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST"]

export function badgeLabel(slot: string | null | undefined, position: string): string {
  const raw = (slot || position || "BN").toUpperCase()
  if (raw === "DEF" || raw === "D/ST" || raw === "DST") return "DST"
  if (raw === "SUPER_FLEX") return "SF"
  if (raw === "W/R/T" || raw === "WR/RB" || raw === "RB/WR" || raw === "WR/TE") return "FLEX"
  if (raw === "BN" || raw === "BENCH" || raw === "START") {
    return position.toUpperCase() === "DEF" ? "DST" : (position.toUpperCase().slice(0, 4) || "BN")
  }
  if (raw === "IR" || raw === "TAXI") {
    return position.toUpperCase() === "DEF" ? "DST" : position.toUpperCase().slice(0, 4)
  }
  return raw.length > 4 ? raw.slice(0, 4) : raw
}

function badgeTone(label: string): string {
  if (label === "QB" || label === "TQB") return "qb"
  if (label === "RB") return "rb"
  if (label === "WR") return "wr"
  if (label === "TE") return "te"
  if (label === "FLEX") return "flex"
  if (label === "K") return "k"
  if (label === "DST") return "dst"
  if (label === "SF" || label === "OP") return "sf"
  return "bn"
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^[\s\S]*?[.!?](?:\s|$)/)
  return (match ? match[0] : trimmed).trim()
}

function statusMark(player: AdvicePlayer): { label: string; tone: "out" | "q" | "bye" } | null {
  if (player.onBye) return { label: "BYE", tone: "bye" }
  const injury = player.injury?.toLowerCase() ?? ""
  if (!injury) return null
  if (injury.includes("out") || injury === "o") return { label: "OUT", tone: "out" }
  if (injury.includes("ir") || injury.includes("reserve")) return { label: "IR", tone: "out" }
  if (injury.includes("susp")) return { label: "SUS", tone: "out" }
  if (injury.includes("doubt")) return { label: "D", tone: "q" }
  if (injury.includes("quest")) return { label: "Q", tone: "q" }
  return { label: player.injury?.slice(0, 3).toUpperCase() ?? "", tone: "q" }
}

function matchup(player: AdvicePlayer): string {
  const team = player.nflTeam ?? "FA"
  if (player.onBye) return team
  if (player.opponent) return `${team} vs ${player.opponent}`
  return team
}

export function playoffChip(advice: ManagerAdvice): string {
  if (advice.league.mode === "guillotine") return "Guillotine"
  if (!advice.league.playoffSpots) return "No cut line"
  if (advice.team.inPlayoffSpot) return `#${advice.team.rank} playoff`
  const mine = advice.standings.find((row) => row.isUser)
  if (mine?.gamesBack != null && mine.gamesBack > 0) return `${mine.gamesBack} GB`
  if (mine?.winsBehind != null && mine.winsBehind > 0) return `${mine.winsBehind} back`
  return "Outside"
}

export function prettyRecord(label: string): string {
  return label.replaceAll("-", "–")
}

function RankColumn({
  rank,
  label,
  empty,
}: {
  rank: number | null | undefined
  label: string
  empty?: boolean
}) {
  const missing = rank == null
  return (
    <p className={`ff-rank-col${missing ? " is-unranked" : ""}`}>
      {empty ? "—" : missing ? "Unranked" : rank}
      <span>{label}</span>
    </p>
  )
}

function Ranks({ player, empty }: { player?: AdvicePlayer | null; empty?: boolean }) {
  return (
    <div className="ff-ranks">
      <RankColumn rank={player?.harrisRank ?? null} label="Weekly" empty={empty} />
      <RankColumn rank={player?.seasonRank ?? null} label="Season" empty={empty} />
    </div>
  )
}

function Badge({ slot, position }: { slot?: string | null; position: string }) {
  const label = badgeLabel(slot, position)
  return <span className={`ff-badge ff-badge-${badgeTone(label)}`}>{label}</span>
}

export function PlayerRow({
  player,
  slot,
  action,
}: {
  player: AdvicePlayer
  slot?: string | null
  action?: "Add" | "Drop"
}) {
  const mark = statusMark(player)
  return (
    <div className="ff-player">
      <Badge slot={slot ?? player.slot} position={player.position} />
      <div>
        <p className="ff-name">{player.name}</p>
        <p className="ff-meta">
          <span>{matchup(player)}</span>
          {mark ? <span className={`ff-mark ff-mark-${mark.tone}`}>{mark.label}</span> : null}
          {action ? <span className={`ff-mark ff-mark-${action === "Add" ? "add" : "drop"}`}>{action}</span> : null}
        </p>
      </div>
      <Ranks player={player} />
    </div>
  )
}

export function EmptySlot({ slot }: { slot: string }) {
  const label = badgeLabel(slot, slot)
  return (
    <div className="ff-player">
      <span className={`ff-badge ff-badge-${badgeTone(label)}`}>{label}</span>
      <div>
        <p className="ff-name ff-name-empty">Empty</p>
        <p className="ff-meta">Open {label}</p>
      </div>
      <Ranks empty />
    </div>
  )
}

export function RosterSkeleton() {
  return (
    <div className="ff-skel" aria-hidden>
      <h2 className="ff-label">Starters</h2>
      {EMPTY_LINEUP.map((slot, index) => (
        <div key={`${slot}-${index}`} className="ff-player">
          <span className={`ff-badge ff-badge-${badgeTone(badgeLabel(slot, slot))}`}>{badgeLabel(slot, slot)}</span>
          <div>
            <p className="ff-name">Loading player</p>
            <p className="ff-meta">Loading matchup</p>
          </div>
          <Ranks empty />
        </div>
      ))}
    </div>
  )
}

export function MoveRow({
  add,
  drop,
  reason,
}: {
  add: AdvicePlayer
  drop: AdvicePlayer | null
  reason: string
}) {
  return (
    <article className="ff-move">
      <PlayerRow player={add} slot={add.position} action="Add" />
      <p className="ff-drop">
        <span>Drop</span>
        {drop ? drop.name : "None"}
        {drop ? <span className="ff-drop-pos">{badgeLabel(drop.slot, drop.position)}</span> : null}
      </p>
      <p className="ff-reason">{firstSentence(reason)}</p>
    </article>
  )
}

export function DropRow({ player, reason }: { player: AdvicePlayer; reason: string }) {
  return (
    <article className="ff-move">
      <PlayerRow player={player} slot={player.position} action="Drop" />
      <p className="ff-reason">{firstSentence(reason)}</p>
    </article>
  )
}

export function RosterBoard({ advice }: { advice: ManagerAdvice }) {
  const groups = [
    ["Starters", advice.roster.starters],
    ["Bench", advice.roster.bench],
    ["Reserve", advice.roster.reserve],
  ] as const
  return (
    <div>
      {advice.holes.length > 0 ? <p className="ff-need">Need a healthy starter at {advice.holes.join(", ")}.</p> : null}
      {groups.map(([title, slots]) =>
        slots.length === 0 ? null : (
          <section key={title}>
            <h2 className="ff-label">{title}</h2>
            {slots.map((slot, index) =>
              slot.player ? (
                <PlayerRow key={`${slot.slot}-${slot.player.id}-${index}`} player={slot.player} slot={slot.slot} />
              ) : (
                <EmptySlot key={`${slot.slot}-empty-${index}`} slot={slot.slot} />
              ),
            )}
          </section>
        ),
      )}
      <section>
        <h2 className="ff-label">Playoff picture</h2>
        {advice.standings.map((row) => (
          <div key={row.id}>
            <div className={row.isUser ? "ff-standing ff-standing-mine" : "ff-standing"}>
              <span className="ff-rank">{row.rank}</span>
              <span className="ff-name">{row.name}</span>
              <span className="ff-rec">{prettyRecord(row.recordLabel)}</span>
              <span className="ff-pts">{row.pointsFor.toFixed(1)}</span>
            </div>
            {advice.league.playoffSpots === row.rank ? <p className="ff-cut">Cut line</p> : null}
          </div>
        ))}
      </section>
    </div>
  )
}

export function WaiverBoard({ advice }: { advice: ManagerAdvice }) {
  if (advice.claims.length === 0) {
    return <p className="ff-empty-line">No waiver claims this week. The wire is empty or the useful players are already free agents.</p>
  }
  return (
    <section>
      <h2 className="ff-label">Waiver claims</h2>
      {advice.claims.map((claim) => (
        <MoveRow key={claim.add.id} add={claim.add} drop={claim.drop} reason={claim.reason} />
      ))}
    </section>
  )
}

export function TradeBoard({ advice }: { advice: ManagerAdvice }) {
  if (advice.trades.length === 0) {
    return (
      <p className="ff-empty-line">
        No trade this week. Season-long rank still decides who is the wrong value to hold.
      </p>
    )
  }
  return (
    <section>
      <h2 className="ff-label">Trade suggestions</h2>
      {advice.trades.map((trade) => (
        <article key={trade.player.id} className="ff-move">
          <PlayerRow player={trade.player} slot={trade.player.position} action="Drop" />
          {trade.target ? (
            <p className="ff-drop">
              <span>For</span>
              {trade.target.name}
              <span className="ff-drop-pos">{trade.targetTeam}</span>
            </p>
          ) : (
            <p className="ff-drop">
              <span>Shop</span>
              Season-long rank
            </p>
          )}
          <p className="ff-reason">{firstSentence(trade.reason)}</p>
        </article>
      ))}
    </section>
  )
}

export function AgentBoard({ advice }: { advice: ManagerAdvice }) {
  return (
    <div>
      <section>
        <h2 className="ff-label">Free agents</h2>
        {advice.freeAgents.length === 0 ? (
          <p className="ff-empty-line">No free agents cleared the bar this week.</p>
        ) : (
          advice.freeAgents.map((pick) => (
            <MoveRow key={pick.player.id} add={pick.player} drop={pick.suggestedDrop} reason={pick.reason} />
          ))
        )}
      </section>
      <section>
        <h2 className="ff-label">Cuts</h2>
        {advice.drops.length === 0 ? (
          <p className="ff-empty-line">No clear cut outside the lineup worth protecting.</p>
        ) : (
          advice.drops.map((drop) => <DropRow key={drop.player.id} player={drop.player} reason={drop.reason} />)
        )}
      </section>
    </div>
  )
}

export function TabIcon({ name }: { name: "roster" | "waivers" | "trades" | "agents" }) {
  if (name === "roster") {
    return (
      <svg viewBox="0 0 24 22" aria-hidden>
        <path fill="currentColor" d="M4 3.5h16a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Zm1.5 3.2h5.2v2.2H5.5V6.7Zm0 4h5.2v2.2H5.5v-2.2Zm0 4h5.2V17H5.5v-2.3Zm7.2-8h5.8v2.2h-5.8V6.7Zm0 4h5.8v2.2h-5.8v-2.2Zm0 4h5.8V17h-5.8v-2.3Z" />
      </svg>
    )
  }
  if (name === "waivers") {
    return (
      <svg viewBox="0 0 24 22" aria-hidden>
        <path fill="currentColor" d="M11 3h2v6h6v2h-6v6h-2v-6H5V9h6V3Z" />
      </svg>
    )
  }
  if (name === "trades") {
    return (
      <svg viewBox="0 0 24 22" aria-hidden>
        <path fill="currentColor" d="M5 6h9.2l-2.1-2.1 1.4-1.4L18 7l-4.5 4.5-1.4-1.4L14.2 8H5V6Zm14 10H9.8l2.1 2.1-1.4 1.4L6 15l4.5-4.5 1.4 1.4L9.8 14H19v2Z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 22" aria-hidden>
      <path fill="currentColor" d="M8.2 11.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Zm7.6.4a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2ZM3.4 18.4c.4-2.6 2.5-4.2 4.8-4.2s4.4 1.6 4.8 4.2H3.4Zm8.2-.2c-.2-1.6.2-3 1.2-4 .6-.1 1.2-.2 1.9-.2 2 0 3.7 1.3 4.1 3.6v.6h-7.2Z" />
    </svg>
  )
}
