// Who each bot is at the table. A seat's personality is derived from its name, so it survives a server
// restart (the room snapshot stores names, not personas) and the same bot always behaves like itself.
// Personality drives three things: how often a bot jumps into the chat, how fast it loses its temper,
// and the register the text model writes in.
import type { BotLang } from './config';

export interface Persona {
  /** Short description of the character, written straight into the prompt. */
  style: string;
  /** 0..1 - how readily this bot swears and escalates when pushed. */
  temper: number;
  /** 0..1 - how often it jumps into a conversation it was not addressed in. */
  chattiness: number;
  /** 0..1 - how quickly it starts accusing people on thin evidence. */
  paranoia: number;
}

interface Archetype extends Omit<Persona, 'style'> {
  style: Record<BotLang, string>;
}

/**
 * Table archetypes. Every real Secret Hitler table has these people in it: the one who screams, the one
 * who says nothing for ten minutes and then buries you, the one who finds it all hilarious.
 */
const ARCHETYPES: Archetype[] = [
  {
    style: {
      'es-AR': 'explosivo y frontal. Puteás rápido, hablás en mayúsculas cuando te calentás, no te guardás nada.',
      en: 'loud and blunt. You swear fast, you type in caps when you are angry, you hold nothing back.',
    },
    temper: 0.9, chattiness: 0.8, paranoia: 0.6,
  },
  {
    style: {
      'es-AR': 'irónico y filoso. Cargás a todos con sarcasmo, casi nunca levantás la voz, pero lo que decís duele.',
      en: 'dry and sarcastic. You mock everyone, you rarely raise your voice, but what you say stings.',
    },
    temper: 0.4, chattiness: 0.7, paranoia: 0.5,
  },
  {
    style: {
      'es-AR': 'paranoico. Ves fascistas en todos lados, atás cabos que no existen y acusás primero y preguntás después.',
      en: 'paranoid. You see fascists everywhere, you connect dots that are not there, you accuse first and ask later.',
    },
    temper: 0.6, chattiness: 0.9, paranoia: 0.95,
  },
  {
    style: {
      'es-AR': 'callado y calculador. Hablás poco, pero cuando hablás tirás un dato concreto que deja a alguien pagando.',
      en: 'quiet and calculating. You barely speak, but when you do you drop a hard fact that leaves someone exposed.',
    },
    temper: 0.25, chattiness: 0.3, paranoia: 0.4,
  },
  {
    style: {
      'es-AR': 'payaso. Te cagás de risa de todo, hacés chistes hasta cuando te están por fusilar, pero no sos tonto.',
      en: 'the clown. You joke about everything, even when you are about to be shot, but you are not stupid.',
    },
    temper: 0.5, chattiness: 0.85, paranoia: 0.3,
  },
  {
    style: {
      'es-AR': 'el que se hace el razonable. Hablás tranquilo, pedís que todos se calmen, y usás eso para que te crean.',
      en: 'the reasonable one. You speak calmly, you ask everyone to settle down, and you use that to be believed.',
    },
    temper: 0.2, chattiness: 0.6, paranoia: 0.35,
  },
  {
    style: {
      'es-AR': 'resentido. Te acordás de todo lo que te hicieron en rondas anteriores y lo sacás a cada rato.',
      en: 'the grudge holder. You remember everything anyone did to you in earlier rounds and bring it up constantly.',
    },
    temper: 0.75, chattiness: 0.65, paranoia: 0.7,
  },
  {
    style: {
      'es-AR': 'cabeza caliente pero noble. Te calentás en dos segundos y se te pasa en dos segundos.',
      en: 'hot-headed but decent. You flare up in two seconds and get over it in two seconds.',
    },
    temper: 0.85, chattiness: 0.7, paranoia: 0.45,
  },
];

/** Stable 32-bit hash of a string, so a name always maps to the same character. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function personaFor(name: string, lang: BotLang): Persona {
  const h = hash(name);
  const a = ARCHETYPES[h % ARCHETYPES.length];
  // Nudge the dials per name so two bots sharing an archetype still differ.
  const jitter = (shift: number) => (((h >>> shift) & 0xff) / 255 - 0.5) * 0.2;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return {
    style: a.style[lang] ?? a.style.en,
    temper: clamp(a.temper + jitter(8)),
    chattiness: clamp(a.chattiness + jitter(16)),
    paranoia: clamp(a.paranoia + jitter(24)),
  };
}

/** Bot names per language: a Rioplatense table should not be full of Ingrids and Cyruses. */
export const BOT_NAMES: Record<BotLang, string[]> = {
  'es-AR': ['Nacho', 'Moni', 'Bruno', 'Tincho', 'Vicky', 'Gastón', 'Flor', 'Rama', 'Ceci', 'Beto', 'Pili', 'Juanma'],
  en: ['Vera', 'Otto', 'Mabel', 'Rex', 'Ingrid', 'Silas', 'Dolores', 'Hank', 'Pearl', 'Cyrus', 'Greta', 'Lou'],
};
