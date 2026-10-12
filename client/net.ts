// WebSocket connection with automatic reconnect.
import type { ClientMsg, RoomView, ServerMsg } from '../shared/protocol';
import { tr } from './i18n';
import { shouldFlushAct, type PendingAct } from './netqueue';

export class Net {
  private ws: WebSocket | null = null;
  private backoff = 500;
  private queue: string[] = [];
  private pendingAct: PendingAct | null = null;
  private lost = false;
  onMessage: (m: ServerMsg) => void = () => {};
  onOpen: () => void = () => {};
  onStatus: (s: string) => void = () => {};
  actContext: () => { phase: string; seat: number } | null = () => null;
  onReconnect: () => void = () => {};

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.onStatus('');
      this.onOpen();
      for (const m of this.queue.splice(0)) ws.send(m);
      if (this.lost) {
        this.lost = false;
        this.onReconnect();
      }
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
      this.lost = true;
      this.onStatus(tr({ en: 'Connection lost. Reconnecting…', es: 'Conexión perdida. Reconectando…' }));
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(8000, this.backoff * 1.7);
    };
  }

  send(m: ClientMsg) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (m.t === 'act') this.pendingAct = null; // a fresh act supersedes the stale one
      this.ws.send(s);
    } else if (m.t === 'act') {
      // Keep only the last offline act; flushAct replays it if the fresh room still wants it.
      const ctx = this.actContext();
      this.pendingAct = ctx ? { msg: s, phase: ctx.phase, seat: ctx.seat } : null;
    } else if (this.queue.length < 20) this.queue.push(s);
  }

  /** Send the offline act once if the fresh room still wants it; always drops it. */
  flushAct(room: RoomView | null) {
    const p = this.pendingAct;
    if (!p) return;
    this.pendingAct = null;
    if (shouldFlushAct(p, room) && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(p.msg);
  }
}
