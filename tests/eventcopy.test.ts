import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../client/i18n';
import type { Beat } from '../client/beats';
import { eventCopy, powerCopy } from '../client/eventcopy';

const NAMES = ['Ann', 'Bob', 'Cy', 'Di', 'Ed'];
const name = (s: number) => NAMES[s];
const copy = (e: Beat, me: number | undefined = 0) => eventCopy(e, name, me);

describe('eventCopy', () => {
  it('chaos and veto unlocked', () => {
    expect(copy({ k: 'chaos' })).toEqual({ text: 'CHAOS! Three failed governments. The top policy is enacted.', kind: 'bad' });
    expect(copy({ k: 'vetoUnlocked' })).toEqual({
      text: 'VETO UNLOCKED. The Chancellor may now propose to discard both policies, if the President agrees.',
      kind: 'power',
    });
  });

  it('power beats use powerCopy', () => {
    expect(copy({ k: 'power', power: 'peek', president: 1 })).toEqual({ text: 'Policy peek: the President looks at the top three policies.', kind: 'power' });
    expect(copy({ k: 'power', power: 'investigate', president: 1 })?.text).toBe('Investigate loyalty: the President inspects a party card.');
    expect(copy({ k: 'power', power: 'special', president: 1 })?.text).toBe('Special election: the President picks the next President.');
    expect(copy({ k: 'power', power: 'execute', president: 1 })?.text).toBe('Execution: the President picks up the pistol.');
    expect(powerCopy('execute')).toBe('Execution: the President picks up the pistol.');
  });

  it('enacted, chaos and not', () => {
    expect(copy({ k: 'enacted', policy: 'L', chaos: false })).toEqual({ text: 'Liberal policy enacted.', kind: 'liberal' });
    expect(copy({ k: 'enacted', policy: 'F', chaos: false })).toEqual({ text: 'Fascist policy enacted.', kind: 'fascist' });
    expect(copy({ k: 'enacted', policy: 'L', chaos: true })).toEqual({ text: 'The top policy is Liberal.', kind: 'liberal' });
    expect(copy({ k: 'enacted', policy: 'F', chaos: true })).toEqual({ text: 'The top policy is Fascist.', kind: 'fascist' });
  });

  it('hitlerRevealed', () => {
    expect(copy({ k: 'hitlerRevealed', seat: 0 })).toEqual({ text: 'You were Hitler!', kind: 'bad' });
    expect(copy({ k: 'hitlerRevealed', seat: 2 })).toEqual({ text: 'Cy was Hitler!', kind: 'bad' });
  });

  it('nominated', () => {
    expect(copy({ k: 'nominated', president: 1, target: 0 })).toEqual({ text: 'Bob nominates YOU for Chancellor!', kind: 'power' });
    expect(copy({ k: 'nominated', president: 0, target: 2 })).toEqual({ text: 'You nominate Cy for Chancellor.', kind: 'info' });
    expect(copy({ k: 'nominated', president: 1, target: 2 })).toEqual({ text: 'Bob nominates Cy for Chancellor.', kind: 'info' });
  });

  it('newPresident', () => {
    expect(copy({ k: 'newPresident', seat: 0, special: false })).toEqual({ text: 'You are the President.', kind: 'info' });
    expect(copy({ k: 'newPresident', seat: 3, special: true })).toEqual({ text: 'Di is President.', kind: 'power' });
  });

  it('votes count ja and nein', () => {
    expect(copy({ k: 'votes', votes: [true, true, false, null, true], passed: true })).toEqual({ text: 'JA! 3 to 1. The government is elected.', kind: 'good' });
    expect(copy({ k: 'votes', votes: [false, false, true, false, null], passed: false })).toEqual({ text: 'NEIN. 1 to 3. The election fails.', kind: 'bad' });
  });

  it('tracker is silent at 0', () => {
    expect(copy({ k: 'tracker', value: 0 })).toBeNull();
    expect(copy({ k: 'tracker', value: 2 })).toEqual({ text: 'Election tracker: 2 of 3.', kind: 'bad' });
    expect(copy({ k: 'vetoTracker', value: 1 })).toEqual({ text: 'The veto counts as a failed government: election tracker 1 of 3.', kind: 'bad' });
  });

  it('timedOut only for me', () => {
    expect(copy({ k: 'timedOut', seat: 0 })).toEqual({ text: 'Time ran out, a move was made for you', kind: 'bad' });
    expect(copy({ k: 'timedOut', seat: 1 })).toBeNull();
  });

  it('executed', () => {
    expect(copy({ k: 'executed', by: 1, target: 0 })).toEqual({ text: 'You have been executed.', kind: 'bad' });
    expect(copy({ k: 'executed', by: 0, target: 3 })).toEqual({ text: 'Di has been executed.', kind: 'bad' });
  });

  it('vetoProposed and vetoAnswer', () => {
    expect(copy({ k: 'vetoProposed', seat: 0 })).toEqual({ text: 'You propose a VETO.', kind: 'power' });
    expect(copy({ k: 'vetoProposed', seat: 4 })).toEqual({ text: 'Ed proposes a VETO.', kind: 'power' });
    expect(copy({ k: 'vetoAnswer', accepted: true })).toEqual({ text: 'Veto accepted. Both policies are discarded.', kind: 'power' });
    expect(copy({ k: 'vetoAnswer', accepted: false })).toEqual({ text: 'Veto refused. The Chancellor must enact.', kind: 'bad' });
  });

  it('investigated and specialElected use subj', () => {
    expect(copy({ k: 'investigated', by: 0, target: 2 })).toEqual({ text: 'You investigate Cy.', kind: 'power' });
    expect(copy({ k: 'investigated', by: 1, target: 2 })).toEqual({ text: 'Bob investigates Cy.', kind: 'power' });
    expect(copy({ k: 'specialElected', by: 0, target: 3 })).toEqual({ text: 'You call a special election: Di will preside.', kind: 'power' });
    expect(copy({ k: 'specialElected', by: 1, target: 3 })).toEqual({ text: 'Bob calls a special election: Di will preside.', kind: 'power' });
  });

  it('night and reshuffle', () => {
    expect(copy({ k: 'nightStart' })).toEqual({ text: 'Night falls. Open your envelope.', kind: 'night' });
    expect(copy({ k: 'reshuffled', deck: 11 })).toEqual({ text: 'The discard pile is shuffled back into the deck.', kind: 'info' });
  });

  it('beats without copy are null', () => {
    expect(copy({ k: 'voted', seat: 1 })).toBeNull();
    expect(copy({ k: 'acked', seat: 1 })).toBeNull();
    expect(copy({ k: 'peeked', seat: 1 })).toBeNull();
  });
});

describe('eventCopy in Spanish', () => {
  beforeEach(() => setLang('es'));
  afterEach(() => setLang('en'));

  it('powers', () => {
    expect(powerCopy('peek')).toBe('Ver leyes: el Presidente mira las tres leyes de arriba.');
    expect(powerCopy('investigate')).toBe('Investigar lealtad: el Presidente inspecciona un carné de partido.');
    expect(powerCopy('special')).toBe('Elección especial: el Presidente elige al próximo Presidente.');
    expect(powerCopy('execute')).toBe('Ejecución: el Presidente toma la pistola.');
  });

  it('nominated, to you and to someone else', () => {
    expect(copy({ k: 'nominated', president: 1, target: 0 })?.text).toBe('¡Bob te nomina a TI como Canciller!');
    expect(copy({ k: 'nominated', president: 0, target: 2 })?.text).toBe('Nominas a Cy como Canciller.');
    expect(copy({ k: 'nominated', president: 1, target: 2 })?.text).toBe('Bob nomina a Cy como Canciller.');
  });

  it('votes, enacted and executed', () => {
    expect(copy({ k: 'votes', votes: [true, true, false, null, true], passed: true })?.text).toBe('JA! 3 a 1. Se elige el gobierno.');
    expect(copy({ k: 'enacted', policy: 'F', chaos: false })?.text).toBe('Ley fascista promulgada.');
    expect(copy({ k: 'executed', by: 1, target: 0 })?.text).toBe('Te han ejecutado.');
    expect(copy({ k: 'executed', by: 0, target: 3 })?.text).toBe('Di ha sido ejecutado.');
  });

  it('switching back to English returns English', () => {
    setLang('en');
    expect(copy({ k: 'enacted', policy: 'F', chaos: false })?.text).toBe('Fascist policy enacted.');
    expect(powerCopy('execute')).toBe('Execution: the President picks up the pistol.');
  });
});
