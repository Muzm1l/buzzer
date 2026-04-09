import { useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";

type View = "landing" | "host" | "buzzer";
type LandingTab = "host" | "cohost" | "join";
type HostPanel = "buzzer" | "scoreboard";
type RoundStatus = "waiting" | "open" | "locked";
type ScoreFlash = "up" | "down";

type BuzzEntry = { team: string; ts: number };

type ServerMessage =
  | {
      type: "sync";
      roundOpen: boolean;
      order: BuzzEntry[];
      scores: Record<string, number>;
      teams: string[];
    }
  | { type: "room-created"; hostCode: string }
  | {
      type: "host-login-success";
      hostCode: string;
      scores: Record<string, number>;
      teams: string[];
      roundOpen: boolean;
      order: BuzzEntry[];
    }
  | { type: "host-login-fail" }
  | { type: "round-open" }
  | { type: "round-reset" }
  | { type: "round-lock" }
  | { type: "buzz-ack"; order: BuzzEntry[] }
  | { type: "scores"; scores: Record<string, number>; teams: string[] };

const PARTYKIT_HOST = import.meta.env.DEV
  ? "127.0.0.1:1999"
  : "buzzer-app.YOUR_USERNAME.partykit.dev";

function randomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function medalFor(index: number): string {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `#${index + 1}`;
}

function formatDelta(order: BuzzEntry[], idx: number): string {
  if (!order[idx] || !order[0]) return "+0.00s";
  return `+${((order[idx].ts - order[0].ts) / 1000).toFixed(2)}s`;
}

function App() {
  const [view, setView] = useState<View>("landing");
  const [landingTab, setLandingTab] = useState<LandingTab>("host");
  const [hostPanel, setHostPanel] = useState<HostPanel>("buzzer");

  const [hostName, setHostName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomInputJoin, setRoomInputJoin] = useState("");
  const [roomInputCohost, setRoomInputCohost] = useState("");
  const [hostCodeInput, setHostCodeInput] = useState("");

  const [hostCode, setHostCode] = useState("");
  const [pendingHostCode, setPendingHostCode] = useState("");
  const [showHostCodeModal, setShowHostCodeModal] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [cohostError, setCohostError] = useState("");

  const [scores, setScores] = useState<Record<string, number>>({});
  const [teams, setTeams] = useState<string[]>([]);
  const [buzzOrder, setBuzzOrder] = useState<BuzzEntry[]>([]);
  const [roundOpen, setRoundOpen] = useState(false);
  const [roundStatus, setRoundStatus] = useState<RoundStatus>("waiting");
  const [myBuzzed, setMyBuzzed] = useState(false);
  const [myPlace, setMyPlace] = useState<number | null>(null);
  const [manualScoreInput, setManualScoreInput] = useState<Record<string, string>>({});
  const [scoreFlash, setScoreFlash] = useState<Record<string, ScoreFlash>>({});

  const [socket, setSocket] = useState<PartySocket | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const prevScoresRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
      setSocket(null);
    };
  }, []);

  const resetRoundState = () => {
    setBuzzOrder([]);
    setRoundOpen(false);
    setRoundStatus("waiting");
    setMyBuzzed(false);
    setMyPlace(null);
  };

  const closeSocket = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setSocket(null);
  };

  const connectToRoom = (nextRoomCode: string, onOpen?: (s: PartySocket) => void) => {
    closeSocket();
    const nextSocket = new PartySocket({ host: PARTYKIT_HOST, room: nextRoomCode });
    socketRef.current = nextSocket;
    setSocket(nextSocket);
    nextSocket.onopen = () => onOpen?.(nextSocket);
    nextSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        if (msg.type === "sync") {
          setRoundOpen(msg.roundOpen);
          setRoundStatus(msg.roundOpen ? "open" : "waiting");
          setBuzzOrder(msg.order ?? []);
          setScores(msg.scores ?? {});
          setTeams(msg.teams ?? []);
          if (view === "buzzer") {
            const idx = (msg.order ?? []).findIndex((b) => b.team === teamName.trim());
            setMyBuzzed(idx !== -1);
            setMyPlace(idx !== -1 ? idx : null);
          }
          return;
        }

        if (msg.type === "room-created") {
          setHostCode(msg.hostCode);
          setPendingHostCode(msg.hostCode);
          setShowHostCodeModal(true);
          setIsHost(true);
          return;
        }

        if (msg.type === "host-login-success") {
          setHostCode(msg.hostCode);
          setIsHost(true);
          setCohostError("");
          setScores(msg.scores ?? {});
          setTeams(msg.teams ?? []);
          setRoundOpen(msg.roundOpen);
          setRoundStatus(msg.roundOpen ? "open" : "waiting");
          setBuzzOrder(msg.order ?? []);
          setView("host");
          setHostPanel("buzzer");
          return;
        }

        if (msg.type === "host-login-fail") {
          setCohostError("Invalid host code");
          return;
        }

        if (msg.type === "scores") {
          setScores(msg.scores ?? {});
          setTeams(msg.teams ?? []);
          return;
        }

        if (msg.type === "round-open") {
          setRoundOpen(true);
          setRoundStatus("open");
          setBuzzOrder([]);
          setMyBuzzed(false);
          setMyPlace(null);
          return;
        }

        if (msg.type === "round-reset") {
          setRoundOpen(false);
          setRoundStatus("waiting");
          setBuzzOrder([]);
          setMyBuzzed(false);
          setMyPlace(null);
          return;
        }

        if (msg.type === "round-lock") {
          setRoundOpen(false);
          setRoundStatus("locked");
          return;
        }

        if (msg.type === "buzz-ack") {
          setBuzzOrder(msg.order ?? []);
          const idx = (msg.order ?? []).findIndex((b) => b.team === teamName.trim());
          if (idx !== -1) {
            setMyBuzzed(true);
            setMyPlace(idx);
          }
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    nextSocket.onclose = () => {
      if (socketRef.current === nextSocket) {
        socketRef.current = null;
        setSocket(null);
      }
    };
  };

  useEffect(() => {
    if (view !== "landing") return;
    if (showHostCodeModal) return;
    closeSocket();
  }, [showHostCodeModal, view]);

  useEffect(() => {
    const previous = prevScoresRef.current;
    const changed: Record<string, ScoreFlash> = {};
    for (const team of teams) {
      if (typeof previous[team] !== "number") continue;
      const prevValue = previous[team];
      const nextValue = scores[team] ?? 0;
      if (nextValue > prevValue) changed[team] = "up";
      if (nextValue < prevValue) changed[team] = "down";
    }
    prevScoresRef.current = { ...scores };
    if (Object.keys(changed).length === 0) return;

    setScoreFlash((current) => ({ ...current, ...changed }));
    const timeout = window.setTimeout(() => {
      setScoreFlash((current) => {
        const clone = { ...current };
        for (const key of Object.keys(changed)) delete clone[key];
        return clone;
      });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [scores, teams]);

  const send = (payload: Record<string, unknown>) => {
    const s = socketRef.current;
    if (!s || s.readyState !== WebSocket.OPEN) return;
    s.send(JSON.stringify(payload));
  };

  const sendHost = (payload: Record<string, unknown>) => {
    if (!hostCode) return;
    send({ ...payload, hostCode });
  };

  const onCreateRoom = () => {
    const code = randomRoomCode();
    setRoomCode(code);
    setIsHost(true);
    setCohostError("");
    setScores({});
    setTeams([]);
    resetRoundState();
    connectToRoom(code, (s) => {
      s.send(JSON.stringify({ type: "create-room" }));
    });
  };

  const continueToHostDashboard = () => {
    setShowHostCodeModal(false);
    setView("host");
    setHostPanel("buzzer");
  };

  const onCohostLogin = () => {
    const code = roomInputCohost.trim().toUpperCase();
    const secret = hostCodeInput.trim().toUpperCase();
    if (!code || !secret) return;
    setRoomCode(code);
    setHostCode(secret);
    setCohostError("");
    resetRoundState();
    connectToRoom(code, (s) => {
      s.send(JSON.stringify({ type: "host-login", hostCode: secret }));
    });
  };

  const onJoinTeam = () => {
    const code = roomInputJoin.trim().toUpperCase();
    const team = teamName.trim();
    if (!code || !team) return;
    setRoomCode(code);
    setIsHost(false);
    resetRoundState();
    connectToRoom(code, (s) => {
      s.send(JSON.stringify({ type: "team-join", team }));
    });
    setView("buzzer");
  };

  const onBuzz = () => {
    if (!roundOpen || myBuzzed || !teamName.trim()) return;
    send({ type: "buzz", team: teamName.trim() });
    setMyBuzzed(true);
  };

  const leaveRoom = () => {
    closeSocket();
    setView("landing");
    setShowHostCodeModal(false);
    setIsHost(false);
    setHostCode("");
    setPendingHostCode("");
    setRoomCode("");
    resetRoundState();
  };

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      const diff = (scores[b] ?? 0) - (scores[a] ?? 0);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });
  }, [scores, teams]);

  const firstTeam = sortedTeams[0] ?? "";
  const buzzerDisabled = !roundOpen || myBuzzed;
  const buzzerLabel = myBuzzed ? (myPlace === 0 ? "FIRST!" : `#${(myPlace ?? 0) + 1}`) : "BUZZ";
  const buzzerClass = myBuzzed
    ? myPlace === 0
      ? "bg-green-600"
      : "bg-gray-400"
    : roundOpen
      ? "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
      : "bg-gray-400";

  const scoreFlashClass = (team: string) => {
    const flash = scoreFlash[team];
    if (flash === "up") return "ring-2 ring-green-400";
    if (flash === "down") return "ring-2 ring-red-400";
    return "";
  };

  const statusText =
    roundStatus === "open"
      ? "Round open - buzz now!"
      : roundStatus === "locked"
        ? "Locked"
        : "Waiting...";
  const hasSocket = socket !== null;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-md space-y-4">
        {view === "landing" && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h1 className="text-center text-3xl font-bold">Buzzer</h1>
            <p className="mt-1 text-center text-sm text-slate-500">Host-auth buzzer + scoreboard</p>

            <div className="mt-5 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
              {(["host", "cohost", "join"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setLandingTab(tab)}
                  className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
                    landingTab === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {tab === "host" ? "Host" : tab === "cohost" ? "Co-Host" : "Join"}
                </button>
              ))}
            </div>

            {landingTab === "host" && (
              <div className="mt-4 space-y-3">
                <input
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Host name"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none ring-blue-500 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={onCreateRoom}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700"
                >
                  Create Room
                </button>
              </div>
            )}

            {landingTab === "cohost" && (
              <div className="mt-4 space-y-3">
                <input
                  value={roomInputCohost}
                  onChange={(e) => setRoomInputCohost(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="Room code"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 uppercase tracking-wider outline-none ring-blue-500 focus:ring-2"
                />
                <input
                  value={hostCodeInput}
                  onChange={(e) => setHostCodeInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="Host code"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono uppercase tracking-wider outline-none ring-blue-500 focus:ring-2"
                />
                {cohostError && <p className="text-sm font-medium text-red-600">{cohostError}</p>}
                <button
                  type="button"
                  onClick={onCohostLogin}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700"
                >
                  Login as Host
                </button>
              </div>
            )}

            {landingTab === "join" && (
              <div className="mt-4 space-y-3">
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Team name"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none ring-blue-500 focus:ring-2"
                />
                <input
                  value={roomInputJoin}
                  onChange={(e) => setRoomInputJoin(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="Room code"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 uppercase tracking-wider outline-none ring-blue-500 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={onJoinTeam}
                  disabled={!teamName.trim() || !roomInputJoin.trim()}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Join Room
                </button>
              </div>
            )}
          </section>
        )}

        {showHostCodeModal && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <p className="text-sm font-semibold text-amber-900">Your host code is:</p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-[0.25em] text-amber-950">{pendingHostCode}</p>
            <p className="mt-2 text-xs text-amber-800">Keep this private. Share only with co-hosts.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(pendingHostCode)}
                className="rounded-lg bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-300"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={continueToHostDashboard}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Continue to dashboard
              </button>
            </div>
          </section>
        )}

        {view === "host" && isHost && (
          <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">Host: {hostName.trim() || "Host"}</p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{hasSocket ? "Connected" : "Offline"}</span>
                <button
                  type="button"
                  onClick={leaveRoom}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Exit
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-900 p-4 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Room Code</p>
                  <p className="mt-1 text-3xl font-bold tracking-[0.18em]">{roomCode}</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(roomCode)}
                  className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/20"
                >
                  Copy
                </button>
              </div>
              <div className="mt-4 rounded-xl bg-amber-100 p-3 text-amber-900">
                <p className="text-xs font-semibold uppercase tracking-wide">Host code</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="font-mono text-lg font-bold tracking-[0.2em]">{hostCode}</p>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(hostCode)}
                    className="rounded-md bg-amber-200 px-2.5 py-1 text-xs font-semibold hover:bg-amber-300"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1 text-xs">Keep this private</p>
              </div>
            </div>

            <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setHostPanel("buzzer")}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  hostPanel === "buzzer" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                Buzzer Control
              </button>
              <button
                type="button"
                onClick={() => setHostPanel("scoreboard")}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  hostPanel === "scoreboard" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                Scoreboard
              </button>
            </div>

            {hostPanel === "buzzer" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => sendHost({ type: "round-open" })}
                    className="rounded-xl bg-green-600 px-2 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
                  >
                    Open Round
                  </button>
                  <button
                    type="button"
                    onClick={() => sendHost({ type: "round-reset" })}
                    className="rounded-xl bg-slate-600 px-2 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => sendHost({ type: "round-lock" })}
                    className="rounded-xl bg-red-600 px-2 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Lock All
                  </button>
                </div>

                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-slate-700">Live Leaderboard</h2>
                  {buzzOrder.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">No buzzes yet.</p>
                  ) : (
                    buzzOrder.map((entry, idx) => (
                      <div
                        key={`${entry.team}-${entry.ts}`}
                        className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                          idx === 0 ? "bg-green-50 text-green-900" : "bg-slate-50"
                        }`}
                      >
                        <p className="font-medium">
                          {medalFor(idx)} {entry.team}
                        </p>
                        <p className="text-sm tabular-nums text-slate-500">{formatDelta(buzzOrder, idx)}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {hostPanel === "scoreboard" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-700">Scoreboard</h2>
                  <button
                    type="button"
                    onClick={() => sendHost({ type: "scores-reset" })}
                    className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                  >
                    Reset all scores
                  </button>
                </div>
                {sortedTeams.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">
                    Teams appear here after joining.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sortedTeams.map((team) => (
                      <div
                        key={team}
                        className={`rounded-xl bg-white p-3 shadow-sm transition ${scoreFlashClass(team)}`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold">{team}</p>
                          <p className="text-2xl font-extrabold tabular-nums">{scores[team] ?? 0}</p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {[10, 5, -5, -10].map((delta) => (
                            <button
                              key={`${team}-${delta}`}
                              type="button"
                              onClick={() => sendHost({ type: "score-update", team, delta })}
                              className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                            >
                              {delta > 0 ? `+${delta}` : delta}
                            </button>
                          ))}
                          <input
                            value={manualScoreInput[team] ?? ""}
                            onChange={(e) =>
                              setManualScoreInput((current) => ({ ...current, [team]: e.target.value }))
                            }
                            placeholder="Set score"
                            className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm outline-none ring-blue-500 focus:ring-2"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const value = Number(manualScoreInput[team] ?? "");
                              if (!Number.isFinite(value)) return;
                              sendHost({ type: "score-set", team, value });
                            }}
                            className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            Set
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {view === "buzzer" && (
          <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{teamName.trim()}</p>
                <p className="text-xs text-slate-500">Room {roomCode}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{hasSocket ? "Connected" : "Offline"}</span>
                <button
                  type="button"
                  onClick={leaveRoom}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Leave
                </button>
              </div>
            </div>

            <p
              className={`rounded-lg px-3 py-2 text-center text-sm font-medium ${
                roundStatus === "open"
                  ? "bg-green-50 text-green-800"
                  : roundStatus === "locked"
                    ? "bg-red-50 text-red-800"
                    : "bg-slate-100 text-slate-700"
              }`}
            >
              {statusText}
            </p>

            <button
              type="button"
              onClick={onBuzz}
              disabled={buzzerDisabled}
              className={`w-full rounded-2xl text-4xl font-extrabold text-white transition ${buzzerClass} disabled:cursor-not-allowed`}
              style={{ minHeight: 160 }}
            >
              {buzzerLabel}
            </button>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700">Leaderboard</h2>
              {buzzOrder.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">No buzzes yet.</p>
              ) : (
                buzzOrder.map((entry, idx) => (
                  <div
                    key={`${entry.team}-${entry.ts}`}
                    className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                      idx === 0 ? "bg-green-50 text-green-900" : "bg-slate-50"
                    }`}
                  >
                    <p className="font-medium">
                      {medalFor(idx)} {entry.team}
                    </p>
                    <p className="text-sm tabular-nums text-slate-500">{formatDelta(buzzOrder, idx)}</p>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700">Scores</h2>
              {sortedTeams.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">No teams yet.</p>
              ) : (
                sortedTeams.map((team) => (
                  <div
                    key={`score-${team}`}
                    className={`flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 transition ${
                      scoreFlashClass(team)
                    } ${
                      team === teamName.trim()
                        ? "border-l-4 border-blue-500 pl-2"
                        : "border-l-4 border-transparent"
                    }`}
                  >
                    <p className="font-medium">
                      {team} {team === firstTeam ? "👑" : ""}
                    </p>
                    <p className="text-lg font-bold tabular-nums">{scores[team] ?? 0}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
