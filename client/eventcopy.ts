// Pure toast copy for table events. No DOM, no three; game.ts decides when to show it.
import type { Power } from '../shared/types';
import type { Beat } from './beats';

export interface EventCopy { text: string; kind: string } // kind is the ui.toast kind

const POWER_TEXT: Record<Power, string> = {
  peek: 'Policy peek: the President looks at the top three policies.',
  investigate: 'Investigate loyalty: the President inspects a party card.',
  special: 'Special election: the President picks the next President.',
  execute: 'Execution: the President picks up the revolver.',
};

export function powerCopy(power: Power): string {
  return POWER_TEXT[power];
}

/** The toast for a beat, or null when it has none. `name` already marks the viewer "(you)". */
export function eventCopy(e: Beat, name: (seat: number) => string, me: number | undefined): EventCopy | null {
  /** 'You nominate' / 'Vera nominates'. */
  const subj = (seat: number, verb: string) => (seat === me ? `You ${verb}` : `${name(seat)} ${verb}s`);
  switch (e.k) {
    case 'nightStart':
      return { text: 'Night falls. Open your envelope.', kind: 'night' };
    case 'timedOut':
      return e.seat === me ? { text: 'Time ran out, a move was made for you', kind: 'bad' } : null;
    case 'newPresident':
      return { text: e.seat === me ? 'You are the President.' : `${name(e.seat)} is President.`, kind: e.special ? 'power' : 'info' };
    case 'nominated':
      return e.target === me
        ? { text: `${name(e.president)} nominates YOU for Chancellor!`, kind: 'power' }
        : { text: `${subj(e.president, 'nominate')} ${name(e.target)} for Chancellor.`, kind: 'info' };
    case 'votes': {
      const ja = e.votes.filter((x) => x === true).length;
      const nein = e.votes.filter((x) => x === false).length;
      return e.passed
        ? { text: `JA! ${ja} to ${nein}. The government is elected.`, kind: 'good' }
        : { text: `NEIN. ${ja} to ${nein}. The election fails.`, kind: 'bad' };
    }
    case 'tracker':
      return e.value > 0 ? { text: `Election tracker: ${e.value} of 3.`, kind: 'bad' } : null;
    case 'vetoTracker':
      return { text: `The veto counts as a failed government: election tracker ${e.value} of 3.`, kind: 'bad' };
    case 'chaos':
      return { text: 'CHAOS! Three failed governments. The top policy is enacted.', kind: 'bad' };
    case 'vetoUnlocked':
      return { text: 'VETO UNLOCKED. The Chancellor may now propose to discard both policies, if the President agrees.', kind: 'power' };
    case 'hitlerRevealed':
      return { text: e.seat === me ? 'You were Hitler!' : `${name(e.seat)} was Hitler!`, kind: 'bad' };
    case 'enacted': {
      const word = e.policy === 'L' ? 'Liberal' : 'Fascist';
      return { text: e.chaos ? `The top policy is ${word}.` : `${word} policy enacted.`, kind: e.policy === 'L' ? 'liberal' : 'fascist' };
    }
    case 'reshuffled':
      return { text: 'The discard pile is shuffled back into the deck.', kind: 'info' };
    case 'power':
      return { text: powerCopy(e.power), kind: 'power' };
    case 'investigated':
      return { text: `${subj(e.by, 'investigate')} ${name(e.target)}.`, kind: 'power' };
    case 'specialElected':
      return { text: `${subj(e.by, 'call')} a special election: ${name(e.target)} will preside.`, kind: 'power' };
    case 'executed':
      return { text: e.target === me ? 'You have been executed.' : `${name(e.target)} has been executed.`, kind: 'bad' };
    case 'vetoProposed':
      return { text: `${subj(e.seat, 'propose')} a VETO.`, kind: 'power' };
    case 'vetoAnswer':
      return e.accepted
        ? { text: 'Veto accepted. Both policies are discarded.', kind: 'power' }
        : { text: 'Veto refused. The Chancellor must enact.', kind: 'bad' };
    default:
      return null;
  }
}
