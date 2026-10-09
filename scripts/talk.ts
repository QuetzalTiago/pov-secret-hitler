// Prints a few rounds of bot table talk, so you can hear how the bots sound (and check your API key)
// without opening five browser windows. Uses whatever provider .env configures; with no key it falls
// back to the built-in template lines, which is also worth seeing.
//
//   npm run talk
//   SH_BOT_LANG=en npm run talk
import { config, llmEndpoint } from '../server/config';
import { llmEnabled, llmStats } from '../server/llm';
import { Room, type Conn } from '../server/room';

const PROVOCATIONS = [
  'che a mí me parece que acá alguien está haciendo la cama',
  'para mí el facho es el primero, miren el historial',
  'contestá algo, hace rato que no decís nada',
  'sos un pelotudo, me cagaste la partida',
  'no te creo nada, mentiroso',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { url, model } = llmEndpoint();
  console.log(`provider: ${config.llm.provider}  model: ${model}  lang: ${config.llm.lang}  profanity: ${config.llm.profanity}`);
  console.log(llmEnabled() ? `endpoint: ${url}` : 'no SH_LLM_KEY set: bots will type their built-in template lines.\n');

  const conn: Conn = {
    id: 1,
    room: null,
    seat: -1,
    send: (m) => {
      if (m.t === 'chat') console.log(`  ${m.name}: ${m.text}`);
    },
  };
  const room = new Room('TALK', () => {});
  room.join(conn, 'Vos');
  for (let i = 0; i < 5; i++) room.addBot(conn);
  const err = room.start(conn);
  if (err) throw new Error(err);
  console.log(`mesa: ${room.seats.map((s) => s.name).join(', ')}\n`);

  for (const line of PROVOCATIONS) {
    room.chat(conn, line); // the room echoes it back through conn.send, which prints it
    await sleep(7000); // let the bots read, think and type
  }
  await sleep(3000);

  console.log(`\nlines written by the model: ${llmStats.ok}, failed: ${llmStats.failed}, filtered: ${llmStats.blocked}`);
  if (llmStats.lastError) console.log(`last error: ${llmStats.lastError}`);
  room.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
