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
      try {
        this.onMessage(JSON.parse(e.data as string) as ServerMsg);
      } catch {
        /* ignore malformed */
      }
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
    else if (this.queue.length < 20) this.queue.push(s);
  }
}
