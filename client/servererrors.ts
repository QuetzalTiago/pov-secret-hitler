// The server sends English error text; the client shows it through this table.
import { tr } from './i18n';

const TABLE: Record<string, { en: string; es: string }> = {};
const add = (en: string, es: string) => (TABLE[en] = { en, es });

add('Malformed message.', 'Mensaje mal formado.');
add('Server error.', 'Error del servidor.');
add('Leave your current room first.', 'Sal primero de tu sala actual.');
add('You already have open tables waiting. Start or leave one first.', 'Ya tienes mesas abiertas esperando. Empieza o abandona una primero.');
add('The bar is packed: too many rooms right now. Try later.', 'El bar está lleno: demasiadas salas ahora mismo. Inténtalo más tarde.');
add('Slow down: too many new tables. Try again in a minute.', 'Más despacio: demasiadas mesas nuevas. Inténtalo de nuevo en un minuto.');
add('Could not allocate a room.', 'No se pudo crear una sala.');
add('No room with that code.', 'No hay ninguna sala con ese código.');
add('That room no longer exists.', 'Esa sala ya no existe.');
add('You are not in a room.', 'No estás en ninguna sala.');
add('Slow down.', 'Más despacio.');
add('That game has already started.', 'Esa partida ya ha empezado.');
add('That room is full.', 'Esa sala está llena.');
add('Your seat is gone.', 'Ya no tienes asiento.');
add('You connected from somewhere else.', 'Te has conectado desde otro sitio.');
add('Only the host can change table options.', 'Solo el anfitrión puede cambiar las opciones de la mesa.');
add('The game has started.', 'La partida ya ha empezado.');
add('Only the host can add bots.', 'Solo el anfitrión puede añadir bots.');
add('The table is full.', 'La mesa está llena.');
add('Only the host can remove bots.', 'Solo el anfitrión puede quitar bots.');
add('There are no bots to remove.', 'No hay bots que quitar.');
add('Only the host can start.', 'Solo el anfitrión puede empezar.');
add('Already started.', 'Ya ha empezado.');
add('The game is not over.', 'La partida no ha terminado.');
add('You are not seated.', 'No tienes asiento.');
add('Only the host can deal.', 'Solo el anfitrión puede repartir.');
add('Only the host can start a new game.', 'Solo el anfitrión puede empezar una partida nueva.');
add('No game in progress.', 'No hay ninguna partida en curso.');
add('No game.', 'No hay partida.');
add('That move is not allowed right now.', 'Esa jugada no está permitida ahora mismo.');
add('The dead tell no tales.', 'Los muertos no hablan.');

const NEED_PLAYERS = /^Need at least (\d+) players \(add bots to fill seats\)\.$/;

/** English messages the server can send (for the test that keeps this table in step with the server). */
export function knownServerErrors(): string[] {
  return Object.keys(TABLE);
}

export function translateServerError(msg: string): string {
  const known = TABLE[msg];
  if (known) return tr(known);
  const need = NEED_PLAYERS.exec(msg);
  if (need) return tr({ en: msg, es: `Hacen falta al menos ${need[1]} jugadores (añade bots para llenar los asientos).` });
  return msg;
}
