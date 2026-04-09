import { useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";

type View = "landing" | "host" | "buzzer";
type LandingTab = "host" | "join";

type BuzzEntry = {
  team: string;
  ts: number;
};

type ServerMessage =
  | { type: "sync"; roundOpen: boolean; order: BuzzEntry[] }
  | { type: "round-open" }
  | { type: "round-reset" }
  | { type: "round-lock" }
  | { type: "buzz-ack"; order: BuzzEntry[] };

const PARTYKIT_HOST = import.meta.env.DEV
  ? "127.0.0.1:1999"
  : "buzzer-app.muzm1l.partykit.dev";

function randomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function formatDelta(order: BuzzEntry[], idx: number): string {
  if (!order[idx] || !order[0]) return "+0.00s";
  const deltaMs = order[idx].ts - order[0].ts;
  return `+${(deltaMs / 1000).toFixed(2)}s`;
}

function medalFor(index: number): string {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `#${index + 1}`;
}

function App() {
  const [view, setView] = useState<View>("landing");
  const [landingTab, setLandingTab] = useState<LandingTab>("host");

  const [hostName, setHostName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const [roundOpen, setRoundOpen] = useState(false);
  const [buzzOrder, setBuzzOrder] = useState<BuzzEntry[]>([]);
  const [myPlace, setMyPlace] = useState<number | null>(null);
  const [didBuzz, setDidBuzz] = useState(false);

  const socketRef = useRef<PartySocket | null>(null);

  const identity = useMemo(() => {
    if (view === "host") return hostName.trim() || "Host";
    return teamName.trim() || "Team";
  }, [hostName, teamName, view]);

  useEffect(() => {
    const shouldConnect = (view === "host" || view === "buzzer") && roomCode;
    if (!shouldConnect) return;

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: roomCode,
    });
    socketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        if (msg.type === "sync") {
          setRoundOpen(msg.roundOpen);
          setBuzzOrder(msg.order);

          if (view === "buzzer") {
            const idx = msg.order.findIndex(
              (entry) => entry.team === teamName.trim(),
            );
            setDidBuzz(idx !== -1);
            setMyPlace(idx !== -1 ? idx : null);
          }
          return;
        }

        if (msg.type === "buzz-ack") {
          setBuzzOrder(msg.order);
          if (view === "buzzer") {
            const idx = msg.order.findIndex(
              (entry) => entry.team === teamName.trim(),
            );
            setDidBuzz(idx !== -1);
            setMyPlace(idx !== -1 ? idx : null);
          }
          return;
        }

        if (msg.type === "round-open") {
          setRoundOpen(true);
          setBuzzOrder([]);
          setDidBuzz(false);
          setMyPlace(null);
          return;
        }

        if (msg.type === "round-reset") {
          setRoundOpen(false);
          setBuzzOrder([]);
          setDidBuzz(false);
          setMyPlace(null);
          return;
        }

        if (msg.type === "round-lock") {
          setRoundOpen(false);
        }
      } catch {
        // Ignore malformed message payloads.
      }
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };

    return () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socket.close();
    };
  }, [roomCode, teamName, view]);

  const sendMessage = (payload: object) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  const createRoom = () => {
    const code = randomRoomCode();
    setRoomCode(code);
    setRoundOpen(false);
    setBuzzOrder([]);
    setDidBuzz(false);
    setMyPlace(null);
    setView("host");
  };

  const joinRoom = () => {
    if (!teamName.trim() || !roomInput.trim()) return;
    const code = roomInput.trim().toUpperCase();
    setRoomCode(code);
    setRoundOpen(false);
    setBuzzOrder([]);
    setDidBuzz(false);
    setMyPlace(null);
    setView("buzzer");
  };

  const handleBuzz = () => {
    if (!roundOpen || didBuzz || !teamName.trim()) return;
    sendMessage({ type: "buzz", team: teamName.trim() });
    setDidBuzz(true);
  };

  const buzzerDisabled = !roundOpen || didBuzz;

  const buzzerButtonClass = didBuzz
    ? myPlace === 0
      ? "bg-green-600"
      : "bg-gray-400"
    : buzzerDisabled
      ? "bg-gray-400"
      : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800";

  const buzzerButtonLabel = didBuzz
    ? myPlace === 0
      ? "FIRST!"
      : myPlace !== null
        ? `#${myPlace + 1}`
        : "BUZZED"
    : "BUZZ";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-md">
        {view === "landing" && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h1 className="text-center text-3xl font-bold">Buzzer</h1>
            <p className="mt-2 text-center text-sm text-slate-500">
              Fast live buzz-ins for quiz rounds.
            </p>

            <div className="mt-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setLandingTab("host")}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  landingTab === "host"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Host
              </button>
              <button
                type="button"
                onClick={() => setLandingTab("join")}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  landingTab === "join"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Join
              </button>
            </div>

            {landingTab === "host" ? (
              <div className="mt-5 space-y-3">
                <input
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Host name"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none ring-blue-500 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={createRoom}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white transition hover:bg-blue-700"
                >
                  Create Room
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Team name"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none ring-blue-500 focus:ring-2"
                />
                <input
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  placeholder="Room code"
                  maxLength={6}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 uppercase tracking-wider outline-none ring-blue-500 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={joinRoom}
                  disabled={!teamName.trim() || !roomInput.trim()}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Join Room
                </button>
              </div>
            )}
          </section>
        )}

        {view === "host" && (
          <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Host: {identity}</p>
              <button
                type="button"
                onClick={() => setView("landing")}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Exit
              </button>
            </div>

            <div className="rounded-2xl bg-slate-900 p-4 text-center text-white">
              <p className="text-xs uppercase tracking-widest text-slate-400">
                Room Code
              </p>
              <p className="mt-1 text-4xl font-bold tracking-[0.2em]">
                {roomCode}
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(roomCode)}
                className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
              >
                Copy
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => sendMessage({ type: "round-open" })}
                className="rounded-xl bg-blue-600 px-2 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Open Round
              </button>
              <button
                type="button"
                onClick={() => sendMessage({ type: "round-reset" })}
                className="rounded-xl bg-amber-500 px-2 py-2.5 text-sm font-semibold text-white hover:bg-amber-600"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => sendMessage({ type: "round-lock" })}
                className="rounded-xl bg-slate-700 px-2 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Lock All
              </button>
            </div>

            <div className="pt-1">
              <h2 className="text-sm font-semibold text-slate-700">
                Live Leaderboard
              </h2>
              <div className="mt-2 space-y-2">
                {buzzOrder.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
                    No buzzes yet.
                  </p>
                ) : (
                  buzzOrder.map((entry, idx) => (
                    <div
                      key={`${entry.team}-${entry.ts}`}
                      className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                        idx === 0
                          ? "bg-green-50 text-green-900"
                          : "bg-slate-50 text-slate-800"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-lg">{medalFor(idx)}</span>
                        <span className="font-medium">{entry.team}</span>
                      </div>
                      <span className="text-sm tabular-nums text-slate-500">
                        {formatDelta(buzzOrder, idx)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {view === "buzzer" && (
          <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{teamName.trim()}</p>
                <p className="text-xs text-slate-500">Room {roomCode}</p>
              </div>
              <button
                type="button"
                onClick={() => setView("landing")}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Leave
              </button>
            </div>

            <button
              type="button"
              onClick={handleBuzz}
              disabled={buzzerDisabled}
              className={`w-full rounded-2xl text-4xl font-extrabold text-white transition ${buzzerButtonClass} disabled:cursor-not-allowed`}
              style={{ minHeight: 160 }}
            >
              {buzzerButtonLabel}
            </button>

            <p className="text-center text-xs text-slate-500">
              {roundOpen
                ? didBuzz
                  ? "Buzz submitted."
                  : "Round is open - hit BUZZ now."
                : "Waiting for host to open the round."}
            </p>

            <div className="pt-1">
              <h2 className="text-sm font-semibold text-slate-700">
                Leaderboard
              </h2>
              <div className="mt-2 space-y-2">
                {buzzOrder.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
                    No buzzes yet.
                  </p>
                ) : (
                  buzzOrder.map((entry, idx) => (
                    <div
                      key={`${entry.team}-${entry.ts}`}
                      className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                        idx === 0
                          ? "bg-green-50 text-green-900"
                          : "bg-slate-50 text-slate-800"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-lg">{medalFor(idx)}</span>
                        <span className="font-medium">{entry.team}</span>
                      </div>
                      <span className="text-sm tabular-nums text-slate-500">
                        {formatDelta(buzzOrder, idx)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
