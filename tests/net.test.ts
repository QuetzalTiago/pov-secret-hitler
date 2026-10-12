import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Net } from '../client/net';

class FakeWS {
  static OPEN = 1;
  static last: FakeWS;
  readyState = 0;
  send = vi.fn();
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.last = this;
  }
  open() {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
}

describe('Net', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWS);
    vi.stubGlobal('location', { protocol: 'http:', host: 'x' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const matching = { stage: 'game', you: 1, game: { phase: 'vote', pending: [1] } } as any;
  const offlineNet = () => {
    const net = new Net();
    net.actContext = () => ({ phase: 'vote', seat: 1 });
    net.connect();
    return net;
  };

  it('does not send act on open but queues other messages', () => {
    const net = offlineNet();
    net.send({ t: 'act', a: {} } as any);
    net.send({ t: 'chat', text: 'hi' } as any);
    FakeWS.last.open();
    expect(FakeWS.last.send).toHaveBeenCalledTimes(1);
    expect(FakeWS.last.send).toHaveBeenCalledWith(JSON.stringify({ t: 'chat', text: 'hi' }));
  });

  it('sends the offline act once via flushAct when the room matches', () => {
    const net = offlineNet();
    net.send({ t: 'act', a: { k: 1 } } as any);
    FakeWS.last.open();
    net.flushAct(matching);
    net.flushAct(matching);
    expect(FakeWS.last.send).toHaveBeenCalledTimes(1);
    expect(FakeWS.last.send).toHaveBeenCalledWith(JSON.stringify({ t: 'act', a: { k: 1 } }));
  });

  it('drops the offline act when the room does not match', () => {
    const net = offlineNet();
    net.send({ t: 'act', a: {} } as any);
    FakeWS.last.open();
    net.flushAct({ ...matching, game: { phase: 'legislate', pending: [1] } });
    net.flushAct(matching);
    expect(FakeWS.last.send).not.toHaveBeenCalled();
  });

  it('keeps only the last offline act', () => {
    const net = offlineNet();
    net.send({ t: 'act', a: { k: 1 } } as any);
    net.send({ t: 'act', a: { k: 2 } } as any);
    FakeWS.last.open();
    net.flushAct(matching);
    expect(FakeWS.last.send).toHaveBeenCalledTimes(1);
    expect(FakeWS.last.send).toHaveBeenCalledWith(JSON.stringify({ t: 'act', a: { k: 2 } }));
  });

  it('fires onReconnect on reopen after a close but not on the first open', () => {
    const net = new Net();
    net.onReconnect = vi.fn();
    net.connect();
    FakeWS.last.open();
    expect(net.onReconnect).not.toHaveBeenCalled();
    FakeWS.last.onclose!();
    vi.advanceTimersByTime(1000);
    FakeWS.last.open();
    expect(net.onReconnect).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed JSON', () => {
    const net = new Net();
    net.onMessage = vi.fn();
    net.connect();
    expect(() => FakeWS.last.onmessage!({ data: '{nope' })).not.toThrow();
    expect(net.onMessage).not.toHaveBeenCalled();
  });

  it('lets handler exceptions propagate', () => {
    const net = new Net();
    net.onMessage = () => {
      throw new Error('boom');
    };
    net.connect();
    expect(() => FakeWS.last.onmessage!({ data: '{"t":"x"}' })).toThrow('boom');
  });
});
