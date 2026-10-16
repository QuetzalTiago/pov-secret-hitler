// Pure HUD model: everything the HUD displays, derived from the game view. No DOM, no three.
import type { RoomView } from '../shared/protocol';
import type { Party, Power, Role } from '../shared/types';
import { actingSeats, type GameView } from '../shared/view';
import { hitlerKnowsFascists } from '../shared/rules';
import { tr } from './i18n';

type Verb =
  | 'discard' | 'enact' | 'vote' | 'nominate' | 'shoot' | 'investigate' | 'elect' | 'peek' | 'role' | 'veto'
  | null;
export interface CardConfirmCopy {
  verb: 'DISCARD' | 'ENACT'; // stable code (ui.ts styles from it); verbLabel is what is shown
  verbLabel: string;
  policy: string;
  face: 'L' | 'F';
  detail: string;
  confirm: string;
}

/** Copy for the "are you sure?" panel shown after selecting a policy card. */
export function cardConfirmCopy(verb: 'discard' | 'enact', face: 'L' | 'F', handSize: number): CardConfirmCopy {
  const policy = tr(
    face === 'L' ? { en: 'LIBERAL POLICY', es: 'LEY LIBERAL' } : { en: 'FASCIST POLICY', es: 'LEY FASCISTA' },
  );
  return verb === 'discard'
    ? {
        verb: 'DISCARD',
        verbLabel: tr({ en: 'DISCARD', es: 'DESCARTAR' }),
        policy,
        face,
        detail: tr({
          en: `The other ${handSize - 1} go to the Chancellor.`,
          es: handSize - 1 === 1 ? 'La otra va al Canciller.' : `Las otras ${handSize - 1} van al Canciller.`,
        }),
        confirm: tr({ en: 'Discard it', es: 'Descartarla' }),
      }
    : {
        verb: 'ENACT',
        verbLabel: tr({ en: 'ENACT', es: 'PROMULGAR' }),
        policy,
        face,
        detail: tr({
          en: 'It goes on the board. The other policy is discarded.',
          es: 'Va al tablero. La otra ley se descarta.',
        }),
        confirm: tr({ en: 'Enact it', es: 'Promulgarla' }),
      };
}

/** A private suspicion mark on a roster row: client-only, never sent anywhere. */
export type Mark = '?' | 'L' | 'F' | null;

export function nextMark(m: Mark): Mark {
  return m === null ? '?' : m === '?' ? 'L' : m === 'L' ? 'F' : null;
}

export type Badge = 'president' | 'chancellor' | 'nominee' | 'termLimited' | 'voted' | 'acting';

export interface HudOpts {
  envelopeOpen: boolean; // the night role card is face up
  myVote: boolean | null; // this client's own vote, once cast
  termLimited: number[]; // seats that cannot be nominated Chancellor
  marks?: Record<number, Mark>; // this client's private suspicion marks by seat
  shown?: { liberal: number; fascist: number; tracker: number }; // board counts the 3D table shows (beats may lag the view)
  heldRoles?: readonly (Role | null)[] | null; // non-null while game-over roles are held until the victory ceremony
}

/** The role to show for a seat: the held one while roles are held (null = not held), else the live one. */
export function roleShown(live: Role | null, held: readonly (Role | null)[] | null, seat: number): Role | null {
  return held ? held[seat] ?? null : live;
}

interface RosterEntry {
  seat: number;
  name: string;
  you: boolean;
  alive: boolean;
  bot: boolean;
  away: boolean;
  badges: Badge[];
  knownRole: Role | null;
  mark: Mark; // private suspicion mark (always null on your own row)
  intel: Party | null; // party you learned by investigating this player
}

export interface HudModel {
  status: {
    role: Role | null;
    roleLabel: string;
    roleGoal: string;
    alive: boolean;
    liberal: number;
    fascist: number;
    tracker: number;
    deck: number;
    discard: number;
    round: number;
    powers: (Power | null)[];
  };
  step: { index: number; labels: string[] } | null;
  action: { mine: boolean; title: string; detail: string; verb: Verb; waitingOn: string[] };
  roster: RosterEntry[];
}

function stepLabels(): string[] {
  return [
    tr({ en: 'Nominate', es: 'Nominar' }),
    tr({ en: 'Vote', es: 'Votar' }),
    tr({ en: 'Legislate', es: 'Legislar' }),
    tr({ en: 'Power', es: 'Poder' }),
  ];
}

function roleLabel(role: Role): string {
  return tr(
    role === 'liberal'
      ? { en: 'Liberal', es: 'Liberal' }
      : role === 'fascist'
        ? { en: 'Fascist', es: 'Fascista' }
        : { en: 'Hitler', es: 'Hitler' },
  );
}

/** How the role wins and who it knows, shown at night and as the role chip's tooltip. */
export function roleGoal(role: Role, playerCount: number): string {
  if (role === 'liberal') {
    return tr({
      en: 'Enact 5 Liberal policies or shoot Hitler.',
      es: 'Promulga 5 leyes Liberales o dispara a Hitler.',
    });
  }
  if (role === 'fascist') {
    return tr({
      en: 'Enact 6 Fascist policies, or get Hitler elected Chancellor after 3. You know your team.',
      es: 'Promulga 6 leyes Fascistas, o haz que elijan Canciller a Hitler después de 3. Conoces a tu equipo.',
    });
  }
  const goal = tr({
    en: 'Stay hidden. Get elected Chancellor after 3 Fascist policies.',
    es: 'Pasa desapercibido. Haz que te elijan Canciller después de 3 leyes Fascistas.',
  });
  const knows = hitlerKnowsFascists(playerCount)
    ? tr({ en: 'You know your Fascist.', es: 'Conoces a tu Fascista.' })
    : tr({ en: "You don't know your Fascists.", es: 'No conoces a tus Fascistas.' });
  return `${goal} ${knows}`;
}

function stepIndex(phase: GameView['phase']): number | null {
  switch (phase) {
    case 'nominate':
      return 0;
    case 'vote':
      return 1;
    case 'legPresident':
    case 'legChancellor':
    case 'veto':
      return 2;
    case 'peek':
    case 'investigate':
    case 'special':
    case 'execute':
      return 3;
    default:
      return null;
  }
}

/**
 * Off-screen marker for a projected point (three's Vector3.project output; z > 1 is behind the camera).
 * Null when on screen; else the point pushed out to the ±margin rectangle with the angle of its direction.
 */
export function edgeMarker(
  ndc: { x: number; y: number; z: number },
  margin = 0.9,
): { x: number; y: number; angle: number } | null {
  const behind = ndc.z > 1;
  if (!behind && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) return null;
  // Behind the camera the projection is mirrored: negate so the marker points the way to turn.
  const x = behind ? -ndc.x : ndc.x;
  const y = behind ? -ndc.y : ndc.y;
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (m < 1e-6) return { x: margin, y: 0, angle: 0 }; // dead behind: no direction, pick one
  return { x: (x * margin) / m, y: (y * margin) / m, angle: Math.atan2(y, x) };
}

/**
 * The candidate an edge arrow should point at: null when there are none or any is on screen
 * (an arrow is only for when you cannot see a move), else the one nearest the view direction (smallest angle).
 */
export function guideTarget<T extends { ndc: { x: number; y: number; z: number }; angle: number }>(cands: T[]): T | null {
  let best: T | null = null;
  for (const c of cands) {
    if (edgeMarker(c.ndc) === null) return null;
    if (!best || c.angle < best.angle) best = c;
  }
  return best;
}

/** Slow 0..1 sine for idle glows on clickable things (same rate as the envelope pulse). */
export function idlePulse(t: number): number {
  return 0.5 + 0.5 * Math.sin(t * 4);
}

export function hudModel(v: GameView, room: RoomView, opts: HudOpts): HudModel {
  const me = room.you;
  const name = (seat: number | null) => (seat === null ? '?' : (v.players[seat]?.name ?? '?'));
  const mePlayer = v.players[me];
  const alive = mePlayer?.alive ?? true;
  const over = v.phase === 'gameOver';
  const mine = !over && (v.phase === 'night' ? !mePlayer?.acked : v.pending.includes(me));
  const waitingOn = over ? [] : v.pending.filter((s) => s !== me).map(name);
  const shown = opts.shown ?? v;
  const pres = name(v.president);
  const chanc = name(v.chancellor);

  let title = '';
  let detail = '';
  let verb: Verb = null;
  switch (v.phase) {
    case 'night':
      if (!mine) {
        title = tr({ en: 'Eyes closed', es: 'Ojos cerrados' });
        detail = tr({ en: `Waiting for ${v.pending.length} more…`, es: `Esperando a ${v.pending.length} más…` });
      } else if (!opts.envelopeOpen) {
        title = tr({ en: 'Check your secret role', es: 'Mira tu rol secreto' });
        detail = tr({ en: 'Click your envelope to see it.', es: 'Haz clic en tu sobre para verlo.' });
        verb = 'role';
      } else {
        title = tr({ en: 'Memorise your role', es: 'Memoriza tu rol' });
        const hint = tr({ en: 'Click the card to close your eyes.', es: 'Haz clic en la carta para cerrar los ojos.' });
        detail = v.yourRole ? `${roleGoal(v.yourRole, v.players.length)} ${hint}` : hint;
        verb = 'role';
      }
      break;
    case 'nominate':
      if (mine) {
        const names = opts.termLimited.map(name).join(', ');
        title = tr({ en: 'Nominate a Chancellor', es: 'Nomina a un Canciller' });
        detail =
          tr({ en: 'Click a player at the table.', es: 'Haz clic en un jugador de la mesa.' }) +
          (names ? tr({ en: ` Term-limited: ${names}.`, es: ` Con mandato limitado: ${names}.` }) : '');
        verb = 'nominate';
      } else {
        title = tr({ en: `President ${pres} is choosing`, es: `El Presidente ${pres} está eligiendo` });
        detail = tr({ en: 'Waiting for a Chancellor nomination.', es: 'Esperando la nominación de un Canciller.' });
      }
      break;
    case 'vote':
      if (mine && opts.myVote === null) {
        title = tr({ en: 'Vote on the government', es: 'Vota el gobierno' });
        const nominee = name(v.nominee);
        detail = tr({
          en: `President ${pres} · Chancellor ${nominee}` + (v.nominee === me ? ' (you!)' : ''),
          es: `Presidente ${pres} · Canciller ${nominee}` + (v.nominee === me ? ' (¡tú!)' : ''),
        });
        verb = 'vote';
      } else {
        title = tr({ en: 'Votes are coming in', es: 'Llegan los votos' });
        const voted = v.players.filter((p) => p.hasVoted).length;
        const total = v.players.filter((p) => p.alive).length;
        detail = tr({ en: `${voted} of ${total} voted`, es: `${voted} de ${total} han votado` });
        if (opts.myVote !== null) detail += ' ' + tr({ en: 'Click your ballot to take it back.', es: 'Haz clic en tu papeleta para retirarla.' });
      }
      break;
    case 'legPresident':
      if (mine) {
        title = tr({ en: 'Discard one policy', es: 'Descarta una ley' });
        detail = tr({
          en: `Click the card to throw away. The other two go to Chancellor ${chanc}.`,
          es: `Haz clic en la carta para tirarla. Las otras dos van al Canciller ${chanc}.`,
        });
        verb = 'discard';
      } else {
        title = tr({ en: `President ${pres} is discarding`, es: `El Presidente ${pres} está descartando` });
        detail = tr({
          en: 'One of three policies goes to the discard pile.',
          es: 'Una de las tres leyes va al descarte.',
        });
      }
      break;
    case 'legChancellor':
      if (mine) {
        const vetoHint = v.vetoUnlocked && !v.vetoRefused;
        title = tr({ en: 'Enact one policy', es: 'Promulga una ley' });
        detail = tr({
          en: 'Click the card to enact; the other is discarded.' + (vetoHint ? ' Or stamp VETO.' : ''),
          es: 'Haz clic en la carta para promulgarla; la otra se descarta.' + (vetoHint ? ' O sella el VETO.' : ''),
        });
        verb = 'enact';
      } else {
        title = tr({ en: `Chancellor ${chanc} is enacting`, es: `El Canciller ${chanc} está promulgando` });
        detail = tr({ en: 'One of two policies becomes law.', es: 'Una de las dos leyes se convierte en ley.' });
      }
      break;
    case 'veto':
      if (mine) {
        title = tr({ en: 'Accept the veto?', es: '¿Aceptas el veto?' });
        detail = tr({
          en: `Chancellor ${chanc} wants to discard both. Slam JA! or NEIN.`,
          es: `El Canciller ${chanc} quiere descartar ambas. Golpea JA! o NEIN.`,
        });
        verb = 'veto';
      } else {
        title = tr({
          en: `President ${pres} is considering the veto`,
          es: `El Presidente ${pres} está considerando el veto`,
        });
        detail = tr({
          en: `Chancellor ${chanc} wants to discard both policies. A veto advances the election tracker.`,
          es: `El Canciller ${chanc} quiere descartar ambas leyes. Un veto avanza el contador de elecciones.`,
        });
      }
      break;
    case 'peek':
      if (mine) {
        title = tr({ en: 'Peek at the deck', es: 'Mira el mazo' });
        detail = tr({
          en: 'These are the next three policies. Click them to put them back.',
          es: 'Estas son las próximas tres leyes. Haz clic en ellas para devolverlas.',
        });
        verb = 'peek';
      } else {
        title = tr({ en: `President ${pres} is peeking`, es: `El Presidente ${pres} está mirando` });
        detail = tr({
          en: 'Only the President sees the top three policies.',
          es: 'Solo el Presidente ve las tres leyes de arriba.',
        });
      }
      break;
    case 'investigate':
      if (mine) {
        title = tr({ en: 'Investigate a player', es: 'Investiga a un jugador' });
        detail = tr({
          en: 'Click a player to see their party membership.',
          es: 'Haz clic en un jugador para ver su carné de partido.',
        });
        verb = 'investigate';
      } else {
        title = tr({ en: `President ${pres} is investigating`, es: `El Presidente ${pres} está investigando` });
        detail = tr({
          en: 'Choosing whom to investigate. Only the President sees the party card.',
          es: 'Eligiendo a quién investigar. Solo el Presidente ve el carné de partido.',
        });
      }
      break;
    case 'special':
      if (mine) {
        title = tr({ en: 'Choose the next President', es: 'Elige al próximo Presidente' });
        detail = tr({ en: 'Click a player at the table.', es: 'Haz clic en un jugador de la mesa.' });
        verb = 'elect';
      } else {
        title = tr({
          en: `President ${pres} is choosing the next President`,
          es: `El Presidente ${pres} está eligiendo al próximo Presidente`,
        });
        detail = tr({
          en: 'Whoever they pick is the next President; then the order resumes.',
          es: 'Quien elija será el próximo Presidente; luego se retoma el orden.',
        });
      }
      break;
    case 'execute':
      if (mine) {
        title = tr({ en: 'Execute a player', es: 'Ejecuta a un jugador' });
        detail = tr({ en: 'Aim the pistol and click your target.', es: 'Apunta la pistola y haz clic en tu objetivo.' });
        verb = 'shoot';
      } else {
        title = tr({ en: `President ${pres} has the pistol`, es: `El Presidente ${pres} tiene la pistola` });
        detail = tr({
          en: 'Choosing whom to shoot. If it is Hitler, the Liberals win.',
          es: 'Eligiendo a quién disparar. Si es Hitler, ganan los Liberales.',
        });
      }
      break;
    case 'gameOver':
      // the ceremony announces the winner while roles are held
      if (!opts.heldRoles) {
        title = tr(
          v.winner === 'liberal'
            ? { en: 'The Liberals win', es: 'Ganan los Liberales' }
            : { en: 'The Fascists win', es: 'Ganan los Fascistas' },
        );
      }
      break;
  }
  if (!alive && !over) {
    detail = tr({ en: 'You are dead: watch in silence. ', es: 'Estás muerto: mira en silencio. ' }) + detail;
  }

  const index = stepIndex(v.phase);
  const acting = actingSeats(v);
  const roster = v.players.map((p): RosterEntry => {
    const seat = room.seats[p.seat];
    const badges: Badge[] = [];
    if (p.seat === v.president && v.phase !== 'night' && !over) badges.push('president');
    if (p.seat === v.chancellor && v.phase !== 'vote') badges.push('chancellor');
    if (v.phase === 'vote' && p.seat === v.nominee) badges.push('nominee');
    if (opts.termLimited.includes(p.seat)) badges.push('termLimited');
    if (v.phase === 'vote' && p.hasVoted) badges.push('voted');
    if (acting.includes(p.seat)) badges.push('acting');
    return {
      seat: p.seat,
      name: p.name,
      you: p.seat === me,
      alive: p.alive,
      bot: seat?.bot ?? false,
      away: seat ? !seat.connected && !seat.bot : false,
      badges,
      knownRole: roleShown(p.role, opts.heldRoles ?? null, p.seat),
      mark: p.seat === me ? null : (opts.marks?.[p.seat] ?? null),
      intel: v.yourInvestigations.find((i) => i.target === p.seat)?.party ?? null,
    };
  });

  return {
    status: {
      role: v.yourRole,
      roleLabel: v.yourRole ? roleLabel(v.yourRole) : '',
      roleGoal: v.yourRole ? roleGoal(v.yourRole, v.players.length) : '',
      alive,
      liberal: shown.liberal,
      fascist: shown.fascist,
      tracker: shown.tracker,
      deck: v.deckCount,
      discard: v.discardCount,
      round: v.round,
      powers: v.powers,
    },
    step: index === null ? null : { index, labels: stepLabels() },
    action: { mine, title, detail, verb, waitingOn },
    roster,
  };
}

/** Edge-marker label for your next move. */
export function actionLabel(phase: GameView['phase'] | undefined, vetoToken: boolean): string {
  if (phase === 'nominate') return tr({ en: 'Pick a Chancellor', es: 'Elige un Canciller' });
  if (phase === 'investigate') return tr({ en: 'Investigate a player', es: 'Investiga a un jugador' });
  if (phase === 'special') return tr({ en: 'Pick the next President', es: 'Elige al próximo Presidente' });
  if (phase === 'execute') return tr({ en: 'Pick who to shoot', es: 'Elige a quién disparar' });
  if (phase === 'vote') return tr({ en: 'Vote JA or NEIN', es: 'Vota JA o NEIN' });
  if (phase === 'veto') return tr({ en: 'JA or NEIN on the veto', es: 'JA o NEIN al veto' });
  if (phase === 'legChancellor' && vetoToken) return tr({ en: 'Veto token', es: 'Ficha de veto' });
  if (phase === 'night') return tr({ en: 'Your envelope', es: 'Tu sobre' });
  return tr({ en: 'Your move', es: 'Tu turno' });
}

export type ScreenBlood = 'none' | 'spatter' | 'victim';

/** What blood lands on your screen when `victim` is shot at an n-seat table: you, a neighbour (wrapping round), or nobody. */
export function screenBlood(me: number | null, victim: number, n: number): ScreenBlood {
  const seat = (s: number | null): s is number => s !== null && Number.isInteger(s) && s >= 0 && s < n;
  if (n < 2 || !seat(me) || !seat(victim)) return 'none';
  if (me === victim) return 'victim';
  return (me + 1) % n === victim || (me - 1 + n) % n === victim ? 'spatter' : 'none';
}
