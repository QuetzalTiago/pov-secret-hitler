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

  it('does not queue act while disconnected but queues other messages', () => {
    const net = new Net();
    net.connect();
    net.send({ t: 'act', a: {} } as any);
    net.send({ t: 'chat', text: 'hi' } as any);
    FakeWS.last.open();
    expect(FakeWS.last.send).toHaveBeenCalledTimes(1);
    expect(FakeWS.last.send).toHaveBeenCalledWith(JSON.stringify({ t: 'chat', text: 'hi' }));
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
