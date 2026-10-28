import { test, expect } from '@playwright/test';
import { call, registerPlayer } from './support/harness';

// ─────────────────────────────────────────────────────────────────────────────
// Domaine CHAT : le contrat du canal privé à deux (P13 C3, audit-3).
//
// Ce contrat n'avait AUCUNE couverture (aucun vitest chat, aucun e2e) alors
// que le correctif C3 s'y appuie entièrement : la création d'un canal accepte
// les participants supplémentaires EXISTANTS et ajoute la session
// (chat.mjs:131, INVARIANT :18-19) — c'est ce qui rend le DM joueur-à-joueur
// possible sans toucher au serveur. Avant C3, le front n'envoyait que
// [user.id] : chaque "conversation privée" était un salon sans interlocuteur.
//
// On couvre le flux de bout en bout, pas seulement les codes de retour :
// création à deux, visibilité participant (lecture + bootstrap du
// destinataire), diffusion du message, et le 404 anti-énumération pour un
// tiers (chat.mjs:11-13).
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Chat - canal privé à deux (DM)', () => {
  test('la création ajoute la session aux participants valides', async () => {
    const alice = await registerPlayer('ChatAlice');
    const bob = await registerPlayer('ChatBob');

    const created = await call(alice, 'POST', '/api/chat/channels', {
      type: 'private',
      name: 'Conversation privée',
      // Le front n'envoie QUE l'autre joueur : le serveur ajoute la session.
      participants: [bob.id],
    });
    expect(created.status).toBe(201);
    expect(created.body?.ok).toBe(true);
    expect(created.body.channel.type).toBe('private');
    expect(created.body.channel.participants).toContain(alice.id);
    expect(created.body.channel.participants).toContain(bob.id);
    expect(created.body.channel.participants).toHaveLength(2);
  });

  test('le destinataire lit le canal, le voit dans son bootstrap et reçoit les messages', async () => {
    const alice = await registerPlayer('ChatAlice');
    const bob = await registerPlayer('ChatBob');

    const created = await call(alice, 'POST', '/api/chat/channels', {
      type: 'private',
      participants: [bob.id],
    });
    const channelId = created.body.channel.id;

    // Bob (participant) lit le canal : accès participants (chat-helpers:81-82).
    const lectureBob = await call(bob, 'GET', `/api/chat/channels/${channelId}`);
    expect(lectureBob.status).toBe(200);
    expect(lectureBob.body.channel.id).toBe(channelId);

    // Bob découvre le canal dans son bootstrap, sans lien direct.
    const bootstrapBob = await call(bob, 'GET', '/api/chat/bootstrap');
    expect(bootstrapBob.status).toBe(200);
    const idsBob = (bootstrapBob.body?.channels || []).map((c: { id: string }) => c.id);
    expect(idsBob).toContain(channelId);

    // Le message d'alice arrive chez bob par la lecture du canal.
    const envoi = await call(alice, 'POST', `/api/chat/channels/${channelId}/messages`, {
      text: 'Salut, on joue ?',
    });
    expect(envoi.status).toBe(201);
    expect(envoi.body.message.text).toBe('Salut, on joue ?');

    const lectureMessages = await call(bob, 'GET', `/api/chat/channels/${channelId}`);
    const texts = (lectureMessages.body?.messages || []).map((m: { text: string }) => m.text);
    expect(texts).toContain('Salut, on joue ?');
  });

  test('un tiers obtient un 404 (anti-énumération) et un participant inconnu est écarté', async () => {
    const alice = await registerPlayer('ChatAlice');
    const bob = await registerPlayer('ChatBob');
    const carol = await registerPlayer('ChatCarol');

    const created = await call(alice, 'POST', '/api/chat/channels', {
      type: 'private',
      participants: [bob.id],
    });
    const channelId = created.body.channel.id;

    // Carol n'est pas participante : 404, pas 403 — l'existence du canal
    // n'est pas divulguée (PIEGE chat.mjs:22-23).
    const intruse = await call(carol, 'GET', `/api/chat/channels/${channelId}`);
    expect(intruse.status).toBe(404);

    // Un identifiant inconnu est écarté silencieusement (INVARIANT :18-19) :
    // le canal ne contient que la session. Contrat documenté, verrouillé ici.
    const fantome = await call(alice, 'POST', '/api/chat/channels', {
      type: 'private',
      participants: ['USER-INEXISTANT'],
    });
    expect(fantome.status).toBe(201);
    expect(fantome.body.channel.participants).toEqual([alice.id]);
  });
});
