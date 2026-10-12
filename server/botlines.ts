// Player-facing lines for bots that talk without the writing model. Every pool is role-neutral: a Fascist
// and a Liberal bot with the same intent draw from the same pool, so the wording never gives a role away.
// Templates use {name} placeholders, the same ones in every line of a pool (tests keep it so).
// Spanish is Rioplatense chat style ("facha" = a Fascist card, "facho" = a Fascist person).
import type { Rand } from '../shared/smartbot';

export type Lang = 'es-AR' | 'en';

export const POOLS = {
  chaos: {
    es: ['caos, joya.', 'bueno, esto pasa cuando no nos ponemos de acuerdo.', 'increíble, qué desastre.', 'y así se juega, che.', 'tres elecciones al tacho, bárbaro.'],
    en: ['Chaos. Great.', "Well, that's what happens when we can't agree.", 'Wonderful. Just wonderful.', 'Nice teamwork, everyone.', 'Three failed votes. Lovely.'],
  },
  presDrew: {
    es: ['me tocaron {drew} y pasé {gave}.', 'saqué {drew} y pasé {gave}.', 'vi {drew} y pasé {gave}.', 'tenía {drew}, pasé {gave}.', 'me vinieron {drew} y pasé {gave}.'],
    en: ['I drew {drew} and passed {gave}.', 'I saw {drew} and passed {gave}.', 'My draw was {drew}, passed {gave}.', 'I had {drew} and gave {gave}.', 'I got {drew}, passed {gave}.'],
  },
  presPassed: {
    es: ['pasé {gave}.', 'le di {gave}.', 'mandé {gave}.', 'yo pasé {gave}.'],
    en: ['I passed {gave}.', 'I gave {gave}.', 'I sent {gave}.', 'I handed over {gave}.'],
  },
  threeFascists: {
    es: [
      'me tocaron tres fachas, no podía hacer nada.',
      'eran las tres fachas, te lo juro. {partner} lo puede confirmar.',
      'tres fachas, qué mala suerte. {partner} vio lo que pasé.',
      'salieron tres fachas, no tenía opción. {partner} sabe.',
      'las tres eran fachas, no pude hacer nada. Preguntale a {partner}.',
    ],
    en: [
      'I drew three Fascists. Nothing I could do.',
      'All Fascist cards, I swear. {partner} can confirm.',
      'Three Fascists, terrible luck. {partner} saw what I passed.',
      'It was three Fascists, no choice. {partner} knows.',
      'All three were Fascist. Ask {partner}.',
    ],
  },
  presBlame: {
    es: [
      'a {partner} le pasé una liberal y eligió la facha. Acordate de esto.',
      'le pasé una liberal a {partner} y puso la facha. Tomen nota.',
      '{partner} tenía una liberal para elegir y eligió la facha. Ojo con eso.',
      'a {partner} le di una liberal y la tiró. No me cierra.',
      'le ofrecí una liberal a {partner} y se quedó con la facha. Anótenlo.',
    ],
    en: [
      'I passed {partner} a Liberal. They chose Fascist. Remember that.',
      'I gave {partner} a Liberal and they enacted the Fascist. Take note.',
      '{partner} had a Liberal to choose and picked the Fascist. Watch that.',
      'I handed {partner} a Liberal and it got binned. Not good.',
      'I offered {partner} a Liberal and they kept the Fascist. Write it down.',
    ],
  },
  chanGot: {
    es: ['me llegaron {got}.', 'me pasaron {got}.', 'recibí {got}.', 'a mí me vinieron {got}.'],
    en: ['I got {got}.', 'I was handed {got}.', 'I received {got}.', 'My cards were {got}.'],
  },
  twoFascists: {
    es: [
      'me llegaron dos fachas, no podía hacer nada.',
      'dos fachas. ¿Qué querían que haga?',
      'me pasaron dos fachas, no tenía de dónde elegir.',
      'eran dos fachas, no había opción.',
      'dos fachas, che. Tenía las manos atadas.',
    ],
    en: [
      'I got two Fascists. Nothing I could do.',
      'Two Fascists. What was I supposed to do?',
      'Two Fascists, I had no choice to make.',
      'It was two Fascists, no options.',
      'Two Fascists. My hands were tied.',
    ],
  },
  chanBlame: {
    es: [
      '{partner} me pasó dos fachas.',
      'dos fachas. No me miren a mí, pregúntenle a {partner}.',
      'me llegaron dos fachas de parte de {partner}.',
      '{partner} me dio dos fachas, yo no pude elegir.',
      'dos fachas y las puso {partner}. Fíjense eso.',
    ],
    en: [
      '{partner} gave me two Fascists.',
      "Two Fascists. Don't look at me, ask {partner}.",
      'Two Fascists came from {partner}.',
      '{partner} handed me two Fascists, I had no pick.',
      'Two Fascists, and {partner} gave them to me. Think about that.',
    ],
  },
  invLiberal: {
    es: ['{target} es liberal.', 'investigué a {target}: liberal.', '{target} salió liberal.', 'a {target} lo revisé y es liberal.'],
    en: ['{target} is a Liberal.', 'I checked {target}: Liberal.', '{target} came back Liberal.', 'I investigated {target}. Liberal.'],
  },
  invFascist: {
    es: ['{target} es FACHO.', 'investigué a {target}: FACHO.', '{target} salió FACHO.', 'a {target} lo revisé y es FACHO.'],
    en: ['{target} is a FASCIST.', 'I checked {target}: FASCIST.', '{target} came back FASCIST.', 'I investigated {target}. FASCIST.'],
  },
  warnSelf: {
    es: [
      'che, ¿{pres} me va a hacer la cama o qué?',
      '¿{pres} me quiere hacer la cama?',
      'mmm, no sé si {pres} me va a dejar pagando.',
      'ojo que {pres} me puede dejar mal parado.',
    ],
    en: [
      'Is {pres} setting me up here or what?',
      'Is {pres} trying to set me up?',
      "Hmm, not sure {pres} won't leave me holding the bag.",
      'Careful, {pres} could stick me with the blame.',
    ],
  },
  warnOther: {
    es: ['ojo {nom}, te van a hacer la cama.', 'cuidado {nom}, te quieren hacer la cama.', '{nom}, mirá que te van a dejar pagando.', 'che {nom}, andá con cuidado.'],
    en: ['Careful {nom}, they are setting you up.', '{nom}, watch out, this looks like a setup.', '{nom}, they might leave you holding the bag.', 'Heads up {nom}, be careful.'],
  },
  accuseChancellor: {
    es: ['ni en pedo confío en {nom}.', '¿{nom}? ¿con ese historial? nein.', 'a {nom} no le compro nada.', 'no me convence {nom}, nein.'],
    en: ["No way I'm trusting {nom}.", '{nom}? After that record? Nein.', "I'm not buying {nom}.", "{nom} doesn't convince me. Nein."],
  },
  accusePresident: {
    es: ['no me cierran las elecciones de {pres}.', 'no confío en lo que arma {pres}.', 'las jugadas de {pres} me huelen mal.', '{pres} me suena raro, nein.'],
    en: ["I don't trust {pres}'s picks.", "I don't trust what {pres} puts together.", "{pres}'s moves smell off to me.", '{pres} seems off to me. Nein.'],
  },
  nominated: {
    es: ['confíen en mí.', 'no se van a arrepentir.', 'no los voy a defraudar.', 'al fin alguien con criterio.', 'voten tranquilos.'],
    en: ['Trust me.', "You won't regret it.", "I won't let you down.", 'Finally, some sense.', 'Vote with confidence.'],
  },
  executed: {
    es: ['perdón, {target}.', 'había que hacerlo.', 'nada personal, {target}.', 'fue lo mejor para la mesa, {target}.', 'lo siento, {target}, tenía que ser.'],
    en: ['Sorry, {target}.', 'It had to be done.', 'Nothing personal, {target}.', 'It was best for the table, {target}.', 'Sorry {target}, it had to be.'],
  },
  veto: {
    es: ['las dos son fachas. quiero vetar.', 'tengo dos fachas. propongo vetar.', 'son dos fachas, vetemos.', 'dos fachas acá. voy por el veto.'],
    en: ['Both Fascist. I want to veto.', 'I have two Fascists. Proposing a veto.', "It's two Fascists, let's veto.", 'Two Fascists here. Going for the veto.'],
  },
  won: {
    es: ['gg!', 'te lo dije.', 'qué partidazo.', 'buen juego, che.', 'salió como esperaba.'],
    en: ['GG!', 'Told you.', 'What a game.', 'Good game, all.', 'Went as I expected.'],
  },
  lost: {
    es: ['bien jugado.', 'la próxima.', 'se me escapó, che.', 'buen partido igual.', 'la revancha es mía.'],
    en: ['Well played.', 'Next time.', 'It slipped away.', 'Good game anyway.', 'Rematch, then.'],
  },
} satisfies Record<string, { es: string[]; en: string[] }>;

export function fill(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Shuffle bag per key: any `size` consecutive picks for one key are all distinct, and the first pick after a
 *  refill never repeats the last one. One per room, so a line doesn't come back until its pool is used up. */
export class LinePicker {
  private bags = new Map<string, { size: number; left: number[]; last: number }>();

  next(key: string, size: number, rand: Rand): number {
    let bag = this.bags.get(key);
    if (!bag || bag.size !== size) {
      bag = { size, left: [], last: -1 };
      this.bags.set(key, bag);
    }
    if (bag.left.length === 0) {
      const xs = Array.from({ length: size }, (_, i) => i);
      for (let i = size - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [xs[i], xs[j]] = [xs[j], xs[i]];
      }
      if (size > 1 && xs[0] === bag.last) [xs[0], xs[size - 1]] = [xs[size - 1], xs[0]];
      bag.left = xs;
    }
    bag.last = bag.left.shift()!;
    return bag.last;
  }
}

export function poolLine(key: keyof typeof POOLS, lang: Lang, vars: Record<string, string>, rand: Rand, picker?: LinePicker): string {
  const pool = POOLS[key][lang === 'es-AR' ? 'es' : 'en'];
  const i = picker ? picker.next(`${key}:${lang}`, pool.length, rand) : Math.floor(rand() * pool.length);
  return fill(pool[i], vars);
}
