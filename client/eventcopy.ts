// Pure toast copy for table events. No DOM, no three; game.ts decides when to show it.
import type { Power } from '../shared/types';
import type { Beat } from './beats';
import { tr } from './i18n';

export interface EventCopy { text: string; kind: string } // kind is the ui.toast kind

const POWER_TEXT: Record<Power, { en: string; es: string }> = {
  peek: {
    en: 'Policy peek: the President looks at the top three policies.',
    es: 'Ver leyes: el Presidente mira las tres leyes de arriba.',
  },
  investigate: {
    en: 'Investigate loyalty: the President inspects a party card.',
    es: 'Investigar lealtad: el Presidente inspecciona un carné de partido.',
  },
  special: {
    en: 'Special election: the President picks the next President.',
    es: 'Elección especial: el Presidente elige al próximo Presidente.',
  },
  execute: {
    en: 'Execution: the President picks up the revolver.',
    es: 'Ejecución: el Presidente toma el revólver.',
  },
};

export function powerCopy(power: Power): string {
  return tr(POWER_TEXT[power]);
}

/** The toast for a beat, or null when it has none. `name` already marks the viewer "(you)". */
export function eventCopy(e: Beat, name: (seat: number) => string, me: number | undefined): EventCopy | null {
  /** 'You nominate' / 'Vera nominates'; Spanish takes the tú and third-person verb forms. */
  const subj = (seat: number, en: string, es2: string, es3: string) =>
    seat === me ? tr({ en: `You ${en}`, es: es2 }) : tr({ en: `${name(seat)} ${en}s`, es: `${name(seat)} ${es3}` });
  switch (e.k) {
    case 'nightStart':
      return { text: tr({ en: 'Night falls. Open your envelope.', es: 'Cae la noche. Abre tu sobre.' }), kind: 'night' };
    case 'timedOut':
      return e.seat === me
        ? { text: tr({ en: 'Time ran out, a move was made for you', es: 'Se acabó el tiempo, se jugó por ti' }), kind: 'bad' }
        : null;
    case 'newPresident':
      return {
        text:
          e.seat === me
            ? tr({ en: 'You are the President.', es: 'Eres el Presidente.' })
            : tr({ en: `${name(e.seat)} is President.`, es: `${name(e.seat)} es Presidente.` }),
        kind: e.special ? 'power' : 'info',
      };
    case 'nominated':
      return e.target === me
        ? {
            text: tr({
              en: `${name(e.president)} nominates YOU for Chancellor!`,
              es: `¡${name(e.president)} te nomina a TI como Canciller!`,
            }),
            kind: 'power',
          }
        : {
            text: tr({
              en: `${subj(e.president, 'nominate', 'Nominas', 'nomina')} ${name(e.target)} for Chancellor.`,
              es: `${subj(e.president, 'nominate', 'Nominas', 'nomina')} a ${name(e.target)} como Canciller.`,
            }),
            kind: 'info',
          };
    case 'votes': {
      const ja = e.votes.filter((x) => x === true).length;
      const nein = e.votes.filter((x) => x === false).length;
      return e.passed
        ? {
            text: tr({ en: `JA! ${ja} to ${nein}. The government is elected.`, es: `JA! ${ja} a ${nein}. Se elige el gobierno.` }),
            kind: 'good',
          }
        : {
            text: tr({ en: `NEIN. ${ja} to ${nein}. The election fails.`, es: `NEIN. ${ja} a ${nein}. La elección fracasa.` }),
            kind: 'bad',
          };
    }
    case 'tracker':
      return e.value > 0
        ? { text: tr({ en: `Election tracker: ${e.value} of 3.`, es: `Contador de elecciones: ${e.value} de 3.` }), kind: 'bad' }
        : null;
    case 'vetoTracker':
      return {
        text: tr({
          en: `The veto counts as a failed government: election tracker ${e.value} of 3.`,
          es: `El veto cuenta como gobierno fallido: contador de elecciones ${e.value} de 3.`,
        }),
        kind: 'bad',
      };
    case 'chaos':
      return {
        text: tr({
          en: 'CHAOS! Three failed governments. The top policy is enacted.',
          es: '¡CAOS! Tres gobiernos fallidos. Se promulga la ley de arriba.',
        }),
        kind: 'bad',
      };
    case 'vetoUnlocked':
      return {
        text: tr({
          en: 'VETO UNLOCKED. The Chancellor may now propose to discard both policies, if the President agrees.',
          es: '¡VETO DESBLOQUEADO! El Canciller ya puede proponer descartar ambas leyes, si el Presidente está de acuerdo.',
        }),
        kind: 'power',
      };
    case 'hitlerRevealed':
      return {
        text:
          e.seat === me
            ? tr({ en: 'You were Hitler!', es: '¡Eras Hitler!' })
            : tr({ en: `${name(e.seat)} was Hitler!`, es: `¡${name(e.seat)} era Hitler!` }),
        kind: 'bad',
      };
    case 'enacted': {
      const lib = e.policy === 'L';
      const text = e.chaos
        ? tr(
            lib
              ? { en: 'The top policy is Liberal.', es: 'La ley de arriba es liberal.' }
              : { en: 'The top policy is Fascist.', es: 'La ley de arriba es fascista.' },
          )
        : tr(
            lib
              ? { en: 'Liberal policy enacted.', es: 'Ley liberal promulgada.' }
              : { en: 'Fascist policy enacted.', es: 'Ley fascista promulgada.' },
          );
      return { text, kind: lib ? 'liberal' : 'fascist' };
    }
    case 'reshuffled':
      return {
        text: tr({
          en: 'The discard pile is shuffled back into the deck.',
          es: 'El descarte se baraja de nuevo en el mazo.',
        }),
        kind: 'info',
      };
    case 'power':
      return { text: powerCopy(e.power), kind: 'power' };
    case 'investigated':
      return {
        text: tr({
          en: `${subj(e.by, 'investigate', 'Investigas', 'investiga')} ${name(e.target)}.`,
          es: `${subj(e.by, 'investigate', 'Investigas', 'investiga')} a ${name(e.target)}.`,
        }),
        kind: 'power',
      };
    case 'specialElected':
      return {
        text: tr({
          en: `${subj(e.by, 'call', 'Convocas', 'convoca')} a special election: ${name(e.target)} will preside.`,
          es: `${subj(e.by, 'call', 'Convocas', 'convoca')} una elección especial: ${name(e.target)} presidirá.`,
        }),
        kind: 'power',
      };
    case 'executed':
      return {
        text:
          e.target === me
            ? tr({ en: 'You have been executed.', es: 'Te han ejecutado.' })
            : tr({ en: `${name(e.target)} has been executed.`, es: `${name(e.target)} ha sido ejecutado.` }),
        kind: 'bad',
      };
    case 'vetoProposed':
      return {
        text: tr({
          en: `${subj(e.seat, 'propose', 'Propones', 'propone')} a VETO.`,
          es: `${subj(e.seat, 'propose', 'Propones', 'propone')} un VETO.`,
        }),
        kind: 'power',
      };
    case 'vetoAnswer':
      return e.accepted
        ? { text: tr({ en: 'Veto accepted. Both policies are discarded.', es: 'Veto aceptado. Se descartan ambas leyes.' }), kind: 'power' }
        : { text: tr({ en: 'Veto refused. The Chancellor must enact.', es: 'Veto rechazado. El Canciller debe promulgar.' }), kind: 'bad' };
    default:
      return null;
  }
}
