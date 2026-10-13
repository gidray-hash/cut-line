"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AgentBoard,
  EMPTY_LINEUP,
  EmptySlot,
  playoffChip,
  prettyRecord,
  RosterBoard,
  RosterSkeleton,
  TabIcon,
  TradeBoard,
  WaiverBoard,
} from "@/components/manager-board"
import {
  emptyConnections,
  readConnections,
  writeConnections,
  type EspnLink,
  type SleeperLink,
  type StoredConnections,
} from "@/lib/storage"
import {
  connectSleeperUser,
  loadEspnAdvice,
  loadHarrisMeta,
  loadNflState,
  loadSleeperAdvice,
  registerDeskWorker,
} from "@/lib/desk-api"
import type {
  AdviceResult,
  LeagueOption,
  ManagerAdvice,
  Platform,
  SleeperConnectResult,
  TeamOption,
} from "@/lib/types"

type LoadState = "idle" | "loading" | "error"
type Tab = "roster" | "waivers" | "trades" | "agents"
type HarrisMeta = {
  week: number | null
  updated: string | null
  seasonWeek: number | null
  seasonUpdated: string | null
  seasonLabel: string | null
}

export function Desk() {
  const [ready, setReady] = useState(false)
  const [connections, setConnections] = useState<StoredConnections>(emptyConnections)
  const [active, setActive] = useState<Platform | null>(null)
  const [advice, setAdvice] = useState<ManagerAdvice | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [nflWeek, setNflWeek] = useState<number | null>(null)
  const [nflSeason, setNflSeason] = useState<number | null>(null)
  const [harrisMeta, setHarrisMeta] = useState<HarrisMeta | null>(null)
  const [tab, setTab] = useState<Tab>("roster")
  const [sheet, setSheet] = useState(false)
  const [sheetSide, setSheetSide] = useState<Platform>("sleeper")

  const [username, setUsername] = useState("")
  const [sleeperUser, setSleeperUser] = useState<SleeperConnectResult["user"] | null>(null)
  const [leagues, setLeagues] = useState<LeagueOption[]>([])
  const [sleeperTeams, setSleeperTeams] = useState<TeamOption[] | null>(null)
  const [pendingLeague, setPendingLeague] = useState<LeagueOption | null>(null)
  const [sleeperBusy, setSleeperBusy] = useState(false)
  const [sleeperError, setSleeperError] = useState<string | null>(null)

  const [espnLeagueId, setEspnLeagueId] = useState("")
  const [espnSeason, setEspnSeason] = useState(2026)
  const [espnS2, setEspnS2] = useState("")
  const [swid, setSwid] = useState("")
  const [showSecrets, setShowSecrets] = useState(false)
  const [espnTeams, setEspnTeams] = useState<TeamOption[] | null>(null)
  const [espnLeagueName, setEspnLeagueName] = useState("")
  const [espnBusy, setEspnBusy] = useState(false)
  const [espnError, setEspnError] = useState<string | null>(null)

  const persist = useCallback((next: StoredConnections) => {
    setConnections(next)
    writeConnections(next)
  }, [])

  const showAdvice = useCallback((next: ManagerAdvice, platform: Platform) => {
    setAdvice(next)
    setActive(platform)
    setLoadState("idle")
    setError(null)
    setSheet(false)
  }, [])

  const loadSleeper = useCallback(
    async (link: SleeperLink) => {
      setActive("sleeper")
      setLoadState("loading")
      setError(null)
      setAdvice(null)
      try {
        const result = await loadSleeperAdvice({
          leagueId: link.leagueId,
          userId: link.userId,
          rosterId: link.rosterId,
        })
        if (result.kind === "teams") {
          setSleeperTeams(result.teams)
          setPendingLeague({ id: link.leagueId, name: result.leagueName, status: "in_season", teams: result.teams.length })
          setSheet(true)
          setSheetSide("sleeper")
          setLoadState("idle")
          return
        }
        showAdvice(result.advice, "sleeper")
      } catch (cause) {
        setLoadState("error")
        setError(cause instanceof Error ? cause.message : "Sleeper advice failed.")
      }
    },
    [showAdvice],
  )

  const loadEspn = useCallback(
    async (link: EspnLink) => {
      setActive("espn")
      setLoadState("loading")
      setError(null)
      setAdvice(null)
      try {
        const result = await loadEspnAdvice({
          leagueId: link.leagueId,
          season: link.season,
          espnS2: link.espnS2,
          swid: link.swid,
          teamId: link.teamId,
        })
        if (result.kind === "teams") {
          setEspnTeams(result.teams)
          setEspnLeagueName(result.leagueName)
          setSheet(true)
          setSheetSide("espn")
          setLoadState("idle")
          return
        }
        showAdvice(result.advice, "espn")
      } catch (cause) {
        setLoadState("error")
        setError(cause instanceof Error ? cause.message : "ESPN advice failed.")
      }
    },
    [showAdvice],
  )

  useEffect(() => {
    const stored = readConnections()
    const timer = window.setTimeout(() => {
      setConnections(stored)
      setActive(stored.active)
      setReady(true)
      const params = new URLSearchParams(window.location.search)
      const deepUser = params.get("sleeper")
      const deepLeague = params.get("league")
      const deepRoster = Number(params.get("roster"))
      if (!stored.sleeper && deepUser && deepLeague && Number.isInteger(deepRoster)) {
        setLoadState("loading")
        void (async () => {
          try {
            const connected = await connectSleeperUser(deepUser)
            const league = connected.leagues.find((item) => item.id === deepLeague)
            const result = await loadSleeperAdvice({
              leagueId: deepLeague,
              userId: connected.user.userId,
              rosterId: deepRoster,
            })
            if (result.kind !== "advice") {
              setLoadState("idle")
              return
            }
            const link: SleeperLink = {
              username: connected.user.username,
              userId: connected.user.userId,
              displayName: connected.user.displayName,
              avatar: connected.user.avatar,
              leagueId: deepLeague,
              leagueName: league?.name || result.advice.league.name,
              rosterId: deepRoster,
            }
            persist({ ...stored, sleeper: link, active: "sleeper" })
            setSleeperUser(connected.user)
            showAdvice(result.advice, "sleeper")
          } catch (cause) {
            setLoadState("error")
            setError(cause instanceof Error ? cause.message : "Sleeper advice failed.")
          }
        })()
        return
      }
      if (stored.active === "sleeper" && stored.sleeper) void loadSleeper(stored.sleeper)
      else if (stored.active === "espn" && stored.espn) void loadEspn(stored.espn)
    }, 0)
    void loadNflState()
      .then((state) => {
        if (!state?.season || !state.week) return
        setNflWeek(state.week)
        setNflSeason(state.season)
        setEspnSeason(state.season)
      })
      .catch(() => undefined)
    void loadHarrisMeta()
      .then((meta) => {
        if (meta) setHarrisMeta(meta)
      })
      .catch(() => undefined)
    registerDeskWorker()
    return () => window.clearTimeout(timer)
  }, [loadEspn, loadSleeper, persist, showAdvice])

  async function lookupSleeper(event: React.FormEvent) {
    event.preventDefault()
    setSleeperBusy(true)
    setSleeperError(null)
    setLeagues([])
    setSleeperTeams(null)
    try {
      const result = await connectSleeperUser(username)
      setSleeperUser(result.user)
      setLeagues(result.leagues)
      if (result.leagues.length === 1) {
        const league = result.leagues[0]
        if (league) await chooseSleeperLeague(result.user, league)
      }
    } catch (cause) {
      setSleeperError(cause instanceof Error ? cause.message : "Sleeper lookup failed.")
    } finally {
      setSleeperBusy(false)
    }
  }

  async function chooseSleeperLeague(user: SleeperConnectResult["user"], league: LeagueOption) {
    setSleeperBusy(true)
    setSleeperError(null)
    setPendingLeague(league)
    setActive("sleeper")
    setLoadState("loading")
    setAdvice(null)
    try {
      const result = await loadSleeperAdvice({
        leagueId: league.id,
        userId: user.userId,
      })
      if (result.kind === "teams") {
        setSleeperTeams(result.teams)
        setSheet(true)
        setLoadState("idle")
        return
      }
      const link: SleeperLink = {
        username: user.username,
        userId: user.userId,
        displayName: user.displayName,
        avatar: user.avatar,
        leagueId: league.id,
        leagueName: league.name,
        rosterId: Number(result.advice.team.id),
      }
      persist({ ...connections, sleeper: link, active: "sleeper" })
      setSleeperTeams(null)
      showAdvice(result.advice, "sleeper")
    } catch (cause) {
      setLoadState("error")
      setSleeperError(cause instanceof Error ? cause.message : "That league did not load.")
      setError(cause instanceof Error ? cause.message : "That league did not load.")
    } finally {
      setSleeperBusy(false)
    }
  }

  async function chooseSleeperTeam(team: TeamOption) {
    if (!sleeperUser || !pendingLeague) return
    const link: SleeperLink = {
      username: sleeperUser.username,
      userId: sleeperUser.userId,
      displayName: sleeperUser.displayName,
      avatar: sleeperUser.avatar,
      leagueId: pendingLeague.id,
      leagueName: pendingLeague.name,
      rosterId: Number(team.id),
    }
    persist({ ...connections, sleeper: link, active: "sleeper" })
    setSleeperTeams(null)
    await loadSleeper(link)
  }

  async function submitEspn(event: React.FormEvent) {
    event.preventDefault()
    setEspnBusy(true)
    setEspnError(null)
    setEspnTeams(null)
    setActive("espn")
    setLoadState("loading")
    setAdvice(null)
    try {
      const result = await loadEspnAdvice({
        leagueId: espnLeagueId.trim(),
        season: espnSeason,
        espnS2,
        swid,
      })
      if (result.kind === "teams") {
        setEspnTeams(result.teams)
        setEspnLeagueName(result.leagueName)
        setSheet(true)
        setLoadState("idle")
        return
      }
      const link: EspnLink = {
        leagueId: espnLeagueId.trim(),
        season: espnSeason,
        espnS2,
        swid,
        teamId: Number(result.advice.team.id),
        teamName: result.advice.team.name,
        leagueName: result.advice.league.name,
      }
      persist({ ...connections, espn: link, active: "espn" })
      showAdvice(result.advice, "espn")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "ESPN did not load."
      setEspnError(message)
      setError(message)
      setLoadState("error")
    } finally {
      setEspnBusy(false)
    }
  }

  async function chooseEspnTeam(team: TeamOption) {
    const link: EspnLink = {
      leagueId: espnLeagueId.trim() || connections.espn?.leagueId || "",
      season: espnSeason || connections.espn?.season || 2026,
      espnS2: espnS2 || connections.espn?.espnS2 || "",
      swid: swid || connections.espn?.swid || "",
      teamId: Number(team.id),
      teamName: team.name,
      leagueName: espnLeagueName || connections.espn?.leagueName || "ESPN league",
    }
    persist({ ...connections, espn: link, active: "espn" })
    setEspnTeams(null)
    await loadEspn(link)
  }

  async function lookupSavedSleeper(name: string) {
    setSleeperBusy(true)
    setSleeperError(null)
    try {
      const result = await connectSleeperUser(name)
      setSleeperUser(result.user)
      setLeagues(result.leagues)
      setSheet(true)
      setSheetSide("sleeper")
    } catch (cause) {
      setSleeperError(cause instanceof Error ? cause.message : "Sleeper lookup failed.")
    } finally {
      setSleeperBusy(false)
    }
  }

  function disconnect(platform: Platform) {
    const next: StoredConnections = {
      ...connections,
      sleeper: platform === "sleeper" ? null : connections.sleeper,
      espn: platform === "espn" ? null : connections.espn,
      active: connections.active === platform ? (platform === "sleeper" ? (connections.espn ? "espn" : null) : connections.sleeper ? "sleeper" : null) : connections.active,
    }
    persist(next)
    if (platform === "sleeper") {
      setSleeperUser(null)
      setLeagues([])
      setSleeperTeams(null)
      setSleeperError(null)
    } else {
      setEspnTeams(null)
      setEspnError(null)
    }
    if (active === platform) {
      setAdvice(null)
      setError(null)
      setLoadState("idle")
      setActive(next.active)
      if (next.active === "sleeper" && next.sleeper) void loadSleeper(next.sleeper)
      if (next.active === "espn" && next.espn) void loadEspn(next.espn)
    }
  }

  const sleeperLinked = connections.sleeper
  const espnLinked = connections.espn
  const both = Boolean(sleeperLinked && espnLinked)
  const week = advice?.league.week ?? nflWeek
  const season = advice?.league.season ?? nflSeason
  const record = advice ? prettyRecord(advice.team.recordLabel) : null
  const playoff = advice ? playoffChip(advice) : null
  const harris = advice?.harris ?? harrisMeta

  return (
    <div className="ff-app">
      <header className="ff-header">
        <p className="ff-kicker">
          {advice ? `${advice.platform === "sleeper" ? "Sleeper" : "ESPN"} · ${advice.league.name}` : season ? `${season} season` : "Cut Line"}
        </p>
        <div className="ff-header-row">
          <h1 className="ff-week">{week ? `Week ${week}` : "Week"}</h1>
          <button type="button" className="ff-connect" onClick={() => setSheet(true)}>
            Leagues
          </button>
        </div>
        <div className="ff-chips">
          <span className="ff-chip">{record ?? "No record"}</span>
          <span className={advice?.team.inPlayoffSpot ? "ff-chip ff-chip-gold" : "ff-chip"}>{playoff ?? "No league"}</span>
          <span className="ff-chip">{harris?.week ? `Harris Week ${harris.week}` : "Harris weekly"}</span>
          <span className="ff-chip">
            {harris?.seasonWeek ? `${harris.seasonLabel ?? "Season"} Week ${harris.seasonWeek}` : "Season rank"}
          </span>
          {advice ? <span className="ff-chip">{advice.team.name}</span> : null}
        </div>
      </header>

      {both ? (
        <div className="ff-switch" role="group" aria-label="League">
          <button type="button" aria-pressed={active === "sleeper"} onClick={() => sleeperLinked && void loadSleeper(sleeperLinked)}>
            Sleeper
          </button>
          <button type="button" aria-pressed={active === "espn"} onClick={() => espnLinked && void loadEspn(espnLinked)}>
            ESPN
          </button>
        </div>
      ) : null}

      <main aria-live="polite" aria-busy={loadState === "loading"}>
        {loadState === "error" && error ? (
          <div className="ff-error">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                if (active === "sleeper" && connections.sleeper) void loadSleeper(connections.sleeper)
                if (active === "espn" && connections.espn) void loadEspn(connections.espn)
              }}
            >
              Retry roster
            </button>
          </div>
        ) : null}

        {!ready || loadState === "loading" ? <RosterSkeleton /> : null}

        {ready && loadState !== "loading" && advice && tab === "roster" ? <RosterBoard advice={advice} /> : null}
        {ready && loadState !== "loading" && advice && tab === "waivers" ? <WaiverBoard advice={advice} /> : null}
        {ready && loadState !== "loading" && advice && tab === "trades" ? <TradeBoard advice={advice} /> : null}
        {ready && loadState !== "loading" && advice && tab === "agents" ? <AgentBoard advice={advice} /> : null}

        {ready && loadState === "idle" && !advice && !error && tab === "roster" ? (
          <section>
            <h2 className="ff-label">Starters</h2>
            <p className="ff-empty-line">No roster yet. Connect Sleeper or ESPN to fill these spots.</p>
            {EMPTY_LINEUP.map((slot, index) => (
              <EmptySlot key={`${slot}-${index}`} slot={slot} />
            ))}
          </section>
        ) : null}

        {ready && loadState === "idle" && !advice && !error && tab === "waivers" ? (
          <p className="ff-empty-line">Waiver claims use Harris season-long rank once a league is connected.</p>
        ) : null}
        {ready && loadState === "idle" && !advice && !error && tab === "trades" ? (
          <section>
            <h2 className="ff-label">Trade suggestions</h2>
            <p className="ff-empty-line">
              Trades use Harris season-long rank. Connect a league to see who is the wrong value to hold.
            </p>
          </section>
        ) : null}
        {ready && loadState === "idle" && !advice && !error && tab === "agents" ? (
          <p className="ff-empty-line">Free agents and cuts show up here once a league is connected.</p>
        ) : null}
      </main>

      <nav className="ff-tabs" aria-label="Cut Line">
        {(
          [
            ["roster", "Roster"],
            ["waivers", "Waivers"],
            ["trades", "Trades"],
            ["agents", "Agents"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className="ff-tab" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            <TabIcon name={id} />
            {label}
          </button>
        ))}
      </nav>

      {sheet ? (
        <div className="ff-sheet-back" onClick={() => setSheet(false)}>
          <div
            className="ff-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ff-grab" />
            <div className="ff-sheet-head">
              <h2 id="connect-title">Connect</h2>
              <button type="button" onClick={() => setSheet(false)}>
                Done
              </button>
            </div>
            <div className="ff-side" role="group" aria-label="Platform">
              <button type="button" aria-pressed={sheetSide === "sleeper"} onClick={() => setSheetSide("sleeper")}>
                Sleeper
              </button>
              <button type="button" aria-pressed={sheetSide === "espn"} onClick={() => setSheetSide("espn")}>
                ESPN
              </button>
            </div>

            {sheetSide === "sleeper" ? (
              sleeperLinked ? (
                <div>
                  <p className="ff-linked">
                    <strong>{sleeperLinked.displayName}</strong>
                    {sleeperLinked.leagueName}
                  </p>
                  <button type="button" className="ff-primary" onClick={() => void loadSleeper(sleeperLinked)}>
                    Open roster
                  </button>
                  <button
                    type="button"
                    className="ff-quiet"
                    onClick={() => {
                      setSleeperUser({
                        userId: sleeperLinked.userId,
                        username: sleeperLinked.username,
                        displayName: sleeperLinked.displayName,
                        avatar: sleeperLinked.avatar,
                      })
                      setUsername(sleeperLinked.username)
                      void lookupSavedSleeper(sleeperLinked.username)
                    }}
                  >
                    Change league
                  </button>
                  <button type="button" className="ff-danger" onClick={() => disconnect("sleeper")}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <form onSubmit={lookupSleeper}>
                  <div className="ff-field">
                    <label htmlFor="sleeper-username">Sleeper username</label>
                    <input
                      id="sleeper-username"
                      value={username}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Username"
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </div>
                  <button type="submit" className="ff-primary" disabled={sleeperBusy || !username.trim()}>
                    {sleeperBusy ? "Looking up leagues…" : "Find leagues"}
                  </button>
                  <p className="ff-help">Username only. Sleeper has no password, and this app never asks for one.</p>
                </form>
              )
            ) : espnLinked ? (
              <div>
                <p className="ff-linked">
                  <strong>{espnLinked.teamName}</strong>
                  {espnLinked.leagueName}
                </p>
                <button type="button" className="ff-primary" onClick={() => void loadEspn(espnLinked)}>
                  Open roster
                </button>
                <button type="button" className="ff-danger" onClick={() => disconnect("espn")}>
                  Disconnect
                </button>
              </div>
            ) : (
              <form onSubmit={submitEspn}>
                <div className="ff-field">
                  <label htmlFor="espn-league">League id</label>
                  <input
                    id="espn-league"
                    inputMode="numeric"
                    value={espnLeagueId}
                    placeholder="Required"
                    onChange={(event) => setEspnLeagueId(event.target.value)}
                  />
                </div>
                <div className="ff-field">
                  <label htmlFor="espn-season">Season</label>
                  <input
                    id="espn-season"
                    inputMode="numeric"
                    value={String(espnSeason)}
                    onChange={(event) => setEspnSeason(Number(event.target.value))}
                  />
                </div>
                <div className="ff-field">
                  <label htmlFor="espn-s2">espn_s2</label>
                  <input
                    id="espn-s2"
                    type={showSecrets ? "text" : "password"}
                    autoComplete="off"
                    value={espnS2}
                    placeholder="Optional"
                    onChange={(event) => setEspnS2(event.target.value)}
                  />
                </div>
                <div className="ff-field">
                  <label htmlFor="espn-swid">SWID</label>
                  <input
                    id="espn-swid"
                    type={showSecrets ? "text" : "password"}
                    autoComplete="off"
                    placeholder="Optional"
                    value={swid}
                    onChange={(event) => setSwid(event.target.value)}
                  />
                </div>
                <button type="button" className="ff-quiet" onClick={() => setShowSecrets((value) => !value)}>
                  {showSecrets ? "Hide cookies" : "Show cookies"}
                </button>
                <button type="submit" className="ff-primary" disabled={espnBusy || !espnLeagueId.trim()}>
                  {espnBusy ? "Loading league…" : "Load ESPN league"}
                </button>
                <p className="ff-help">
                  League id, season, and the espn_s2 and SWID cookies from a browser where you are already logged in. Passwords are not collected. Cookies stay on this phone. Public leagues can leave them blank.
                </p>
              </form>
            )}

            {sheetSide === "sleeper" && sleeperError ? <p className="ff-form-error">{sleeperError}</p> : null}
            {sheetSide === "espn" && espnError ? <p className="ff-form-error">{espnError}</p> : null}

            {sheetSide === "sleeper" && leagues.length > 0 ? (
              <div>
                <h3 className="ff-label">Choose a league</h3>
                {leagues.map((league) => (
                  <button key={league.id} type="button" className="ff-pick" onClick={() => sleeperUser && void chooseSleeperLeague(sleeperUser, league)}>
                    <span>
                      <strong>{league.name}</strong>
                      <span>
                        {league.teams} teams · {league.status.replaceAll("_", " ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {sheetSide === "sleeper" && sleeperUser && leagues.length === 0 && !sleeperBusy && !sleeperLinked ? (
              <p className="ff-help">No leagues for this season on that username.</p>
            ) : null}
            {sheetSide === "sleeper" && sleeperTeams ? (
              <div>
                <h3 className="ff-label">Which team is yours?</h3>
                {sleeperTeams.map((team) => (
                  <button key={team.id} type="button" className="ff-pick" onClick={() => void chooseSleeperTeam(team)}>
                    <span>
                      <strong>{team.name}</strong>
                      <span>{team.recordLabel}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {sheetSide === "espn" && espnTeams ? (
              <div>
                <h3 className="ff-label">Which team is yours?</h3>
                {espnTeams.map((team) => (
                  <button key={team.id} type="button" className="ff-pick" onClick={() => void chooseEspnTeam(team)}>
                    <span>
                      <strong>{team.name}</strong>
                      <span>{team.recordLabel}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
