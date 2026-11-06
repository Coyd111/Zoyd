import 'dotenv/config';
import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
if (!token) throw new Error('DISCORD_TOKEN manquant (voir .env.example)');

const REPLY = `**ZOYD — oriente-toi en 10 secondes**
Site : zoyd.vercel.app
Règles : <#1551520098009751572>
Comprends : <#1568273460847714366> · <#1551521017019637791>
État réel : <#1551523576677539840>
Litiges / bugs / feedback : <#1568273491558539425>
Pas de staff en DM : c'est toujours une arnaque.`;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log('ZOYD bot pret : ' + c.user.tag);
  c.user.setPresence({
    activities: [{ name: '/zoyd', type: ActivityType.Watching }],
    status: 'online',
  });
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'zoyd') return;
  try {
    await i.reply({ content: REPLY, ephemeral: true });
  } catch (e) {
    console.error('reply fail', e.message);
  }
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
client.login(token);