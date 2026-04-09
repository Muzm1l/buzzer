import type * as Party from "partykit/server";

interface BuzzEntry {
  team: string;
  ts: number;
}

interface RoomState {
  roundOpen: boolean;
  buzzOrder: BuzzEntry[];
  scores: Record<string, number>;
  teams: string[];
  hostCode: string;
}

function randCode(len: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < len; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

export default class BuzzerServer implements Party.Server {
  state: RoomState = {
    roundOpen: false,
    buzzOrder: [],
    scores: {},
    teams: [],
    hostCode: randCode(6), // secret host code, generated once per room
  };

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    // Send full state to whoever just connected
    conn.send(JSON.stringify({
      type: "sync",
      roundOpen: this.state.roundOpen,
      order: this.state.buzzOrder,
      scores: this.state.scores,
      teams: this.state.teams,
      // host code is NOT sent here — only sent when host creates the room
    }));
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg = JSON.parse(message);

    // --- HOST AUTH ---
    const isHost = msg.hostCode === this.state.hostCode;

    // --- ROOM CREATION (first host) ---
    if (msg.type === "create-room") {
      // Return the host code only to the creator
      sender.send(JSON.stringify({
        type: "room-created",
        hostCode: this.state.hostCode,
      }));
    }

    // --- SECONDARY HOST LOGIN ---
    else if (msg.type === "host-login") {
      if (msg.hostCode === this.state.hostCode) {
        sender.send(JSON.stringify({
          type: "host-login-success",
          hostCode: this.state.hostCode,
          scores: this.state.scores,
          teams: this.state.teams,
          roundOpen: this.state.roundOpen,
          order: this.state.buzzOrder,
        }));
      } else {
        sender.send(JSON.stringify({ type: "host-login-fail" }));
      }
    }

    // --- TEAM JOIN ---
    else if (msg.type === "team-join") {
      if (!this.state.teams.includes(msg.team)) {
        this.state.teams.push(msg.team);
        this.state.scores[msg.team] = 0;
      }
      this.room.broadcast(JSON.stringify({
        type: "scores",
        scores: this.state.scores,
        teams: this.state.teams,
      }));
    }

    // --- ROUND CONTROLS (host only) ---
    else if (msg.type === "round-open" && isHost) {
      this.state.roundOpen = true;
      this.state.buzzOrder = [];
      this.room.broadcast(JSON.stringify({ type: "round-open" }));
    }

    else if (msg.type === "round-reset" && isHost) {
      this.state.roundOpen = false;
      this.state.buzzOrder = [];
      this.room.broadcast(JSON.stringify({ type: "round-reset" }));
    }

    else if (msg.type === "round-lock" && isHost) {
      this.state.roundOpen = false;
      this.room.broadcast(JSON.stringify({ type: "round-lock" }));
    }

    // --- BUZZ ---
    else if (msg.type === "buzz") {
      if (!this.state.roundOpen) return;
      if (this.state.buzzOrder.find(b => b.team === msg.team)) return;
      this.state.buzzOrder.push({ team: msg.team, ts: Date.now() });
      this.state.buzzOrder.sort((a, b) => a.ts - b.ts);
      this.room.broadcast(JSON.stringify({
        type: "buzz-ack",
        order: this.state.buzzOrder,
      }));
    }

    // --- SCORE CONTROLS (host only) ---
    else if (msg.type === "score-update" && isHost) {
      const current = this.state.scores[msg.team] ?? 0;
      this.state.scores[msg.team] = current + msg.delta;
      this.room.broadcast(JSON.stringify({
        type: "scores",
        scores: this.state.scores,
        teams: this.state.teams,
      }));
    }

    else if (msg.type === "score-set" && isHost) {
      this.state.scores[msg.team] = msg.value;
      this.room.broadcast(JSON.stringify({
        type: "scores",
        scores: this.state.scores,
        teams: this.state.teams,
      }));
    }

    else if (msg.type === "scores-reset" && isHost) {
      this.state.teams.forEach(t => this.state.scores[t] = 0);
      this.room.broadcast(JSON.stringify({
        type: "scores",
        scores: this.state.scores,
        teams: this.state.teams,
      }));
    }
  }
}