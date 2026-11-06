const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID || '1551506556795883602';
const BOT_ID = '1551508920131002479';
const OWNER_ID = '1551504341276295213';

if (!token) {
  console.error('DISCORD_TOKEN manquant. Usage : DISCORD_TOKEN=xxx GUILD_ID=xxx node check.mjs');
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const H = {
  Authorization: 'Bot ' + token,
  'User-Agent': 'DiscordBot (ZOYD, 1.0)',
};

async function api(path, ok404) {
  const res = await fetch(API + path, { headers: H });
  if (res.status === 404 && ok404) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status + ' sur ' + path);
  return await res.json();
}

const results = [];
function check(label, ok, detail) {
  results.push({ ok: !!ok, label, detail: detail || '' });
}

const CHANNELS = {
  'BIENVENUE': ['bienvenue', 'reglement', 'commencer-ici', 'annonces'],
  'DÉCOUVRIR ZOYD': ['presentation-zoyd', 'comment-ca-marche', 'formats-de-competition', 'etat-du-projet', 'questions-frequentes'],
  'COMMUNAUTÉ': ['discussion-generale', 'presentation-des-joueurs', 'cod-mobile', 'clips-et-gameplay', 'idees-et-suggestions'],
  'PARTICIPER AU PROJET': ['sondages', 'retours-communaute', 'tests-et-beta'],
  'SUIVRE ZOYD': ['reseaux-officiels', 'evenements'],
  'ÉQUIPE ZOYD': ['qg-equipe', 'suivi-moderation', 'planning-communication', 'suivi-retours', 'journal-des-actions'],
};

const ROLE_IDS = {
  Moderateur: '1551527502420377672',
  Communaute: '1551527518870446110',
};

const TICKET_CHANNEL = '1551523562429485216';
const AUDIT_CHANNEL = '1551613860430225509';
const AUTOMOD_NAMES = ['Filet insultes', 'Anti-spam mentions'];

try {
  const me = await api('/users/@me');
  check('Token actif (bot=' + me.username + ')', true, 'id ' + me.id);
} catch (e) {
  check('Token actif', false, 'TOKEN INVALIDE — reset fait ? ' + e.message);
}

let guild = null;
try {
  guild = await api('/guilds/' + guildId + '?with_counts=true');
  check('Serveur QG ZOYD accessible', guild.name === 'QG ZOYD', guild.name + ' | ' + (guild.approximate_member_count ?? '?') + ' membres');
} catch (e) {
  check('Serveur ZOYD accessible', false, 'bot retiré du serveur ? ' + e.message);
}

if (guild) {
  const chans = await api('/guilds/' + guildId + '/channels');
  const byName = new Map(chans.map((c) => [c.name, c]));

  for (const [cat, list] of Object.entries(CHANNELS)) {
    for (const n of list) {
      check('Salon #' + n + ' présent', byName.has(n), byName.has(n) ? 'type ' + byName.get(n).type : 'ABSENT');
    }
  }

  const pinnedTargets = ['bienvenue', 'reglement', 'commencer-ici', 'presentation-zoyd', 'comment-ca-marche', 'formats-de-competition', 'etat-du-projet', 'questions-frequentes', 'retours-communaute', 'tests-et-beta', 'reseaux-officiels'];
  for (const n of pinnedTargets) {
    const c = byName.get(n);
    if (!c) { check('Pin #' + n, false, 'salon absent'); continue; }
    const msgs = await api('/channels/' + c.id + '/messages?limit=25');
    const mine = msgs.find((m) => m.author.id === BOT_ID && m.pinned);
    check('Pin intact #' + n, !!mine, mine ? String(mine.content.length) + ' car' : 'PIN PERDU ou message bot absent');
  }

  let scamTotal = 0;
  for (const c of chans.filter((x) => x.type === 0)) {
    try {
      const msgs = await api('/channels/' + c.id + '/messages?limit=40');
      for (const m of msgs) {
        if (m.author.id !== BOT_ID && (m.mention_everyone || (m.attachments || []).length)) {
          scamTotal++;
          console.log('  !! SUSPECT #' + c.name + ' auteur ' + m.author.username + ' (' + m.author.id + ') everyone=' + m.mention_everyone + ' att=' + (m.attachments || []).length);
        }
      }
    } catch (e) {}
  }
  check('Aucun message @everyone / pièce jointe hors bot', scamTotal === 0, scamTotal === 0 ? '' : scamTotal + ' SUSPECT(S), purge à relancer');

  const roles = await api('/guilds/' + guildId + '/roles');
  const roleIndex = new Map(roles.map((r) => [r.id, r]));
  for (const [name, id] of Object.entries(ROLE_IDS)) {
    check('Rôle ' + name, roleIndex.has(id), roleIndex.has(id) ? '' : 'ABSENT');
  }
  const meRole = roles.find((r) => r.tags && r.tags.bot_id === BOT_ID);
  check('Peut-être : role bot posé', !!meRole, meRole ? 'pos ' + meRole.position : 'role bot introuvable');

  let automodOk = [];
  let automodBad = 0;
  try {
    const am = await api('/guilds/' + guildId + '/auto-moderation/rules');
    for (const want of AUTOMOD_NAMES) {
      const found = am.some((r) => r.name === want);
      if (found) automodOk.push(want); else automodBad++;
    }
  } catch (e) { automodBad = AUTOMOD_NAMES.length; }
  check('AutoMod présent (' + AUTOMOD_NAMES.join(', ') + ')', automodBad === 0, automodBad === 0 ? automodOk.join(', ') : 'AUTO-MOD PERDU — régénérer');

  const whs = await api('/guilds/' + guildId + '/webhooks');
  check('0 webhook inconnu', whs.length === 0, whs.length ? whs.map((w) => w.name).join(', ') : '');

  const invs = await api('/guilds/' + guildId + '/invites');
  const good = invs.find((i) => i.channel && i.channel.id === '1551520094859825162' && !i.max_uses && !i.max_age);
  check('Invite officielle vers #bienvenue prête', !!good, good ? 'code ' + good.code + ' | ' + good.uses + ' usages' : 'AUCUNE — regénérer sur #bienvenue');
  for (const b of invs) if (!good || b.code !== good.code) console.log('  invite secondaire : ' + b.code + ' -> #' + (b.channel ? b.channel.name : '?') + ' | usages ' + b.uses + ' | max ' + b.max_uses);

  let auditUnknown = 0;
  try {
    const raw = await api('/guilds/' + guildId + '/audit-logs?limit=100');
    for (const u of raw.users || []) {
      if (u.id !== BOT_ID && u.id !== OWNER_ID) {
        auditUnknown++;
        console.log('  !! ACTEUR INCONNU dans audit log : ' + u.username + ' (' + u.id + ')');
      }
    }
  } catch (e) {}
  check('Audit log : acteurs connus uniquement', auditUnknown === 0, auditUnknown ? auditUnknown + ' inconnu(s)' : 'bot + owner seulement');
}

console.log('');
console.log('================ RESULTATS ================');
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log((r.ok ? '[ OK ] ' : '[FAIL] ') + r.label + (r.detail ? '  —  ' + r.detail : ''));
}
console.log('');
console.log(fail === 0 ? '>>> Tout est vert. Serveur prêt pour la pub du lien.' : '>>> ' + fail + ' echec(s). Corriger avant de publier le lien.');

console.log('');
console.log('===== A FAIRE A LA MAIN (portal / compte) =====');
console.log('1. Compte : Révoquer toutes les sessions (Securite).');
console.log('2. Compte : revoquer apps inconnues (Connexions).');
console.log('3. Compte : activer 2FA.');
console.log('4. Portal : Developer Portal, app Zoyd, Bot, Reset Token (copie secret Render uniquement).');
console.log('5. Portal : Bot > Server Members Intent ON (auto Nouveau a l\u2019arrivee).');
console.log('6. Serveur : Settings > Enable Community, onboarding (Pays / Mode / Notifs), ecran de bienvenue.');
console.log('7. Render : nouveau worker, root discord-bot/, npm install, node src/index.mjs, 6 env vars.');
console.log('8. Apres deploy : rejouer ce check avec le NOUVEAU token.');
