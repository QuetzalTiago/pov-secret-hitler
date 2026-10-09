// WebSocket connection with automatic reconnect.
import type { ClientMsg, ServerMsg } from '../shared/protocol';

export class Net {
  private ws: WebSocket | null = null;
  private backoff = 500;
  private queue: string[] = [];
  onMessage: (m: ServerMsg) => void = () => {};
  onOpen: () => void = () => {};
  onStatus: (s: string) => void = () => {};

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.onStatus('');
      this.onOpen();
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data as string) as ServerMsg;
      } catch {
        return; // ignore malformed
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      this.onStatus('Connection lost. Reconnecting…');
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(8000, this.backoff * 1.7);
    };
  }

  send(m: ClientMsg) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    // Acts are stale by reconnect time and replaying them could double-send moves.
    else if (m.t !== 'act' && this.queue.length < 20) this.queue.push(s);
  }
}
