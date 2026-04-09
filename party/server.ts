import type * as Party from "partykit/server";

interface BuzzEntry {
  team: string;
  ts: number;
}

interface RoomState {
  roundOpen: boolean;
  buzzOrder: BuzzEntry[];
}

export default class BuzzerServer implements Party.Server {
  state: RoomState = {
    roundOpen: false,
    buzzOrder: [],
  };

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    conn.send(JSON.stringify({
      type: "sync",
      roundOpen: this.state.roundOpen,
      order: this.state.buzzOrder,
    }));
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg = JSON.parse(message);

    if (msg.type === "round-open") {
      this.state.roundOpen = true;
      this.state.buzzOrder = [];
      this.room.broadcast(JSON.stringify({ type: "round-open" }));
    }

    else if (msg.type === "round-reset") {
      this.state.roundOpen = false;
      this.state.buzzOrder = [];
      this.room.broadcast(JSON.stringify({ type: "round-reset" }));
    }

    else if (msg.type === "round-lock") {
      this.state.roundOpen = false;
      this.room.broadcast(JSON.stringify({ type: "round-lock" }));
    }

    else if (msg.type === "buzz") {
      if (!this.state.roundOpen) return;
      const alreadyBuzzed = this.state.buzzOrder.find(b => b.team === msg.team);
      if (alreadyBuzzed) return;

      this.state.buzzOrder.push({
        team: msg.team,
        ts: Date.now(), // server timestamp — fair for everyone
      });

      this.state.buzzOrder.sort((a, b) => a.ts - b.ts);

      this.room.broadcast(JSON.stringify({
        type: "buzz-ack",
        order: this.state.buzzOrder,
      }));
    }
  }
}