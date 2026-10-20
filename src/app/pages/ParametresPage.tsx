/**
 * ParametresPage - reglages du compte : identite, securite, gaming, notifications.
 *
 * Quatre onglets. Permet de modifier le profil, de supprimer son compte, de
 * regler les preferences de notification, et de gerer la 2FA d'administration.
 *
 * INVARIANT : toute sauvegarde passe par updateServerAccount (l'API), puis le
 * store d'auth est mis a jour avec la reponse serveur. Ecrire dans le store
 * sans appel serveur ferait diverger l'ecran du compte reel.
 * INVARIANT : la 2FA admin s'active par un code TOTP a 6 chiffres, et la
 * fenetre de saisie est courte (30 s) : le code doit etre lu depuis
 * l'application d'authentification, pas calcule dans le navigateur.
 * PIEGE : la suppression de compte est refusee s'il reste des wagers en
 * cours. L'UI doit l'expliquer, pas masquer l'action.
 * PIEGE : un 403 metier (mot de passe actuel faux, 2FA) ne doit pas
 * deconnecter la session : seul un 401 purge l'etat.
 * PIEGE : le type `User` de lucide et le type `User` du store portent le
 * meme nom : le type du store est aliase (`AuthUser`). Ne pas retirer
 * l'alias.
 *
 * Voir aussi : docs/08-frontend.md - section 5 (Les gardes client)
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
// L icone `User` vient de lucide, le TYPE `User` d authStore : les deux
// portaient le meme nom, ce que TypeScript refuse. Le type est donc aliase.
import { AlertTriangle, Bell, Gamepad2, Save, Shield, User } from 'lucide-react';
import { toast } from '../lib/toast';
import { useAuthStore, type User as AuthUser } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { updateServerAccount, deleteOwnAccount, fetchAdmin2faStatus, setupAdmin2fa, enableAdmin2fa, verifyAdmin2fa } from '../lib/authApi';
import { ApiError } from '../lib/apiClient';
import { CODM_RANGS, CONTROLLER_OPTIONS, COUNTRY_OPTIONS, DEVICE_OPTIONS } from '../../lib/competition';
import { isAnySupportedPhone } from '../../lib/payoutOperators';
import { SEOHead } from '../components/SEOHead';

const tabs = [
  { id: 'account', label: 'COMPTE', icon: User },
  { id: 'security', label: 'SÉCURITÉ', icon: Shield },
  { id: 'gaming', label: 'GAMING', icon: Gamepad2 },
  { id: 'notifications', label: 'NOTIFICATIONS', icon: Bell },
] as const;

type ActiveTab = (typeof tabs)[number]['id'];

type SettingsForm = Pick<
  AuthUser,
  | 'pseudo'
  | 'phone'
  | 'country'
  | 'streamerMode'
  | 'controllerType'
  | 'device'
  | 'levelCODM'
  | 'rankMJ'
  | 'rankBR'
  | 'email'
> & {
  // Le formulaire normalise en chaîne les deux champs optionnels du profil
  // (`user.bio || ''`, `user.streamerPseudo || ''`) : ils ne sont jamais
  // `undefined` dans l'état du formulaire, contrairement à `AuthUser`.
  bio: string;
  streamerPseudo: string;
};

type NotificationSettings = {
  matchStart: boolean;
  results: boolean;
  messages: boolean;
  tournaments: boolean;
  referrals: boolean;
};

const ParametresPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const prefersReducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<ActiveTab>('account');
  const [isSaving, setIsSaving] = useState(false);
  const [notificationToggles, setNotificationToggles] = useState<NotificationSettings>({
    matchStart: true,
    results: true,
    messages: true,
    tournaments: true,
    referrals: false,
  });
  const [form, setForm] = useState<SettingsForm | null>(null);

  // L'email est l'IDENTIFIANT de connexion : le serveur exige le mot de passe
  // actuel pour l'accepter. On ne l'affiche que si la valeur change vraiment,
  // sinon il faudrait le saisir a chaque enregistrement de profil.
  const [emailConfirmPassword, setEmailConfirmPassword] = useState('');
  const normalizedFormEmail = (form?.email || '').trim().toLowerCase();
  const isEmailChanged = Boolean(user) && normalizedFormEmail !== (user?.email || '').trim().toLowerCase();

  // Le pseudo est libre (un joueur change de pseudo en jeu), mais il reste
  // l'identifiant affiché aux adversaires ET une clé de connexion : d'où la
  // validation immédiate, plutôt qu'un aller-retour serveur pour découvrir
  // qu'on est trop long.
  const normalizedFormPseudo = (form?.pseudo || '').trim();
  const isPseudoChanged = Boolean(user) && normalizedFormPseudo !== (user?.pseudo || '').trim();
  const pseudoError = !isPseudoChanged
    ? ''
    : !normalizedFormPseudo
      ? 'Le pseudo ne peut pas etre vide.'
      : normalizedFormPseudo.length > 30
        ? 'Maximum 30 caracteres.'
        : '';

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Initialisation une seule fois par COMPTE, pas à chaque `user`.
  //
  // Le hook était branché sur `[user]` : toute mise à jour du profil en
  // socket (solde, trustScore, résultat de match) créait un nouvel objet et
  // réinitialisait tout le formulaire. Sur un champ que l'on saisit en
  // continu — le pseudo — cela mangeait la saisie en cours. On dépend donc
  // de l'IDENTITÉ du compte, et la resynchronisation explicite après
  // enregistrement se fait dans le handler de sauvegarde.
  useEffect(() => {
    if (!user) return;
    setForm({
      pseudo: user.pseudo,
      phone: user.phone,
      country: user.country,
      email: user.email,
      bio: user.bio || '',
      streamerMode: user.streamerMode,
      streamerPseudo: user.streamerPseudo || '',
      controllerType: user.controllerType,
      device: user.device,
      levelCODM: user.levelCODM,
      rankMJ: user.rankMJ,
      rankBR: user.rankBR,
    });
  }, [user?.id]);

  // Les notifications arrivent séparément : elles ne doivent surtout pas
  // partager le cycle de vie du formulaire ci-dessus.
  useEffect(() => {
    const notifications = user?.notifications;
    if (!notifications || typeof notifications !== 'object') return;
    setNotificationToggles({
      matchStart: notifications.matchStart ?? true,
      results: notifications.results ?? true,
      messages: notifications.messages ?? true,
      tournaments: notifications.tournaments ?? true,
      referrals: notifications.referrals ?? false,
    });
  }, [user?.notifications]);

  if (!user || !form) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top">
        <div className="text-center">
          <h2 className="text-xl font-display font-black uppercase mb-4">Paramètres indisponibles</h2>
        </div>
      </div>
    );
  }

  const updateForm = <K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
if (form.phone && !isAnySupportedPhone(form.phone)) {
      // On n'impose pas un pays — un joueur peut enregistrer un numéro
      // ivoirien tout en ayant le pays Bénin — mais on écarte les formats
      // qu'aucun retrait ne pourra jamais payer.
      toast.error('Numéro invalide. Exemple : +229 61 00 00 01, ou le numéro d’un pays de retrait.');
      return;
    }
    setIsSaving(true);
    try {
      if (pseudoError) {
        toast.error(pseudoError);
        return;
      }
      const updates: Partial<AuthUser> & { currentPassword?: string } = {
        phone: form.phone,
        country: form.country,
        bio: form.bio.trim() || undefined,
        streamerMode: form.streamerMode,
        streamerPseudo: form.streamerMode ? form.streamerPseudo.trim() || undefined : undefined,
        controllerType: form.controllerType,
        device: form.device,
        levelCODM: Math.max(1, Number(form.levelCODM) || 1),
        rankMJ: form.rankMJ,
        rankBR: form.rankBR,
        notifications: notificationToggles,
      };
      if (isPseudoChanged) {
        updates.pseudo = normalizedFormPseudo;
      }
      if (isEmailChanged) {
        if (!emailConfirmPassword) {
          toast.error('Saisis ton mot de passe actuel pour confirmer le nouvel email.');
          return;
        }
        updates.email = normalizedFormEmail;
        updates.currentPassword = emailConfirmPassword;
      }
      const response = await updateServerAccount(updates);
      if (response.ok) {
        updateUser(response.user);
        setEmailConfirmPassword('');
        // Resynchronise le formulaire sur la VRAIE valeur enregistrée (le
        // serveur peut normaliser/tronquer) : sans ça, `isPseudoChanged`
        // resterait vrai et le mode « dirty » ne se calmerait jamais.
        setForm((prev) => (prev ? { ...prev, pseudo: response.user.pseudo } : prev));
        toast.success('Tes préférences ont bien été enregistrées.');
      } else {
        toast.error('Impossible d\'enregistrer tes paramètres. Réessaye plus tard.');
      }
    } catch (error) {
      // Un pseudo déjà pris remonte en 409 DUPLICATE_PSEUDO : c'est la seule
      // vraie erreur métier attendue ici, elle mérite son message plutôt
      // qu'un « réessaye plus tard » qui ne sert à rien.
      const code = error instanceof ApiError ? error.code : '';
      if (code === 'DUPLICATE_PSEUDO') {
        toast.error('Ce pseudo est déjà utilisé par un autre joueur.');
      } else {
        toast.error('Erreur lors de la sauvegarde de tes paramètres.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      toast.error('Remplis tous les champs.');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Le nouveau mot de passe doit faire au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('Les mots de passe ne correspondent pas.');
      return;
    }
    setIsChangingPassword(true);
    try {
      const { authorizedPost } = await import('../lib/apiClient');
      const res = await authorizedPost<{ ok: boolean }>('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      if (res.ok) {
        toast.success('Mot de passe changé avec succès.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors du changement de mot de passe.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline pb-24 safe-top">
      <SEOHead title="Paramètres — ZOYD" description="Configure ton compte et tes préférences." path="/parametres" noindex />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 pt-16 overflow-hidden">
        <img src="/assets/images/codm-4.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
        <img src="/assets/images/codm-5.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 pb-12">
          <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-7xl font-display font-black uppercase tracking-tighter italic leading-none">
            Paramètres
          </h1>
          <p className="text-white/70 mt-4 max-w-2xl">
            Règle ton profil, ton compte CODM et ce que ZOYD doit prendre en compte pour te proposer les bonnes parties.
          </p>
        </div>
      </header>

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12 grid grid-cols-1 lg:grid-cols-4 gap-8 relative z-10">
        <div className="lg:col-span-1 space-y-2">
          <nav className="space-y-2" role="tablist" aria-label="Paramètres">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 touch-target font-display font-black text-xs tracking-widest italic uppercase transition-all ${
                    isActive
                      ? 'bg-white text-black shadow-[4px_0_0_0_#FFE600]'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="hud-panel p-4 mt-6 bg-red-500/5 border-red-500/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" />
              <div>
                <h4 className="text-[10px] font-mono font-black uppercase tracking-widest text-red-400 mb-1">
                  A savoir
                </h4>
                <p className="text-[10px] font-mono text-white/70">
                  Ce que tu changes ici peut modifier les matchs et tournois qui te sont proposés, ainsi que ce que les autres voient sur ton profil.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <motion.div
            key={activeTab}
            initial={prefersReducedMotion ? false : { opacity: 0, x: 10 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2 }}
            className="space-y-8"
          >
            {activeTab === 'account' ? (
              <div role="tabpanel" id="panel-account" aria-labelledby="tab-account">
                <SectionTitle title="Ton compte" />
                <div className="grid md:grid-cols-2 gap-4">
                  <Input
                    label="Pseudo"
                    value={form.pseudo}
                    onChange={(event) => updateForm('pseudo', event.target.value)}
                    maxLength={30}
                    helperText="Le nom qui t'identifie sur ZOYD. L'arbitre s'en sert pour dire qui a gagne : garde celui que tu utilises en jeu."
                    error={pseudoError || undefined}
                  />
                  <Input
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(event) => updateForm('email', event.target.value)}
                    helperText="Ton email de connexion. Le changer demande de confirmer ton mot de passe."
                    error={isEmailChanged && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedFormEmail) ? 'Email invalide.' : undefined}
                  />
                </div>
                {isEmailChanged ? (
                  <div className="grid md:grid-cols-2 gap-4">
                    <Input
                      label="Mot de passe actuel"
                      type="password"
                      autoComplete="current-password"
                      value={emailConfirmPassword}
                      onChange={(event) => setEmailConfirmPassword(event.target.value)}
                      helperText="Confirmation obligatoire : c'est ton email de connexion."
                      required
                    />
                  </div>
                ) : null}
                <div className="grid md:grid-cols-2 gap-4">
                  <Input
                    label="Téléphone"
                    value={form.phone}
                    onChange={(event) => updateForm('phone', event.target.value)}
                    helperText="Utile pour vérifier ton compte et recevoir tes retraits."
                  />
                  <SelectField
                    label="Pays"
                    value={form.country}
                    onChange={(value) => updateForm('country', value)}
                    options={COUNTRY_OPTIONS.map((country) => ({ value: country, label: country }))}
                  />
                </div>

                <SectionTitle title="Profil public" />
                <div className="space-y-4">
                  <label htmlFor="bio-field" className="block space-y-2">
                    <span className="block text-sm font-medium text-white">Bio</span>
                    <textarea
                      id="bio-field"
                      value={form.bio}
                      onChange={(event) => updateForm('bio', event.target.value)}
                      rows={4}
                      maxLength={500}
                      className="flex w-full border bg-white/5 px-4 py-3 text-base text-white border-white/20 placeholder:text-white/60 focus:border-zoyd-yellow transition-all duration-200"
                      placeholder="Quelques lignes pour décrire ton style de jeu ou ton identité competitive."
                    />
                  </label>

                  <div className="hud-panel p-4 bg-zoyd-surface/20 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <div className="font-display font-black text-white text-sm uppercase italic">Mode streamer</div>
                      <div className="text-[10px] font-mono text-white/70 uppercase tracking-widest mt-1">
                        Affiche un pseudo different quand tu veux jouer ou streamer plus discretement.
                      </div>
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer touch-target">
                      <input
                        type="checkbox"
                        checked={form.streamerMode}
                        onChange={(event) => updateForm('streamerMode', event.target.checked)}
                        className="w-4 h-4 accent-zoyd-yellow"
                      />
                      <span className="text-sm text-white/60">Activer</span>
                    </label>
                  </div>

                  {form.streamerMode ? (
                    <Input
                      label="Pseudo streamer"
                      value={form.streamerPseudo}
                      onChange={(event) => updateForm('streamerPseudo', event.target.value)}
                      helperText="Ce pseudo remplace ton nom public quand le mode streamer est actif."
                    />
                  ) : null}
                </div>

                <DangerZone />
              </div>
            ) : null}

            {activeTab === 'security' ? (
              <div role="tabpanel" id="panel-security" aria-labelledby="tab-security">
                <SectionTitle title="Changer le mot de passe" />
                <div className="space-y-4 max-w-md">
                  <Input
                    label="Mot de passe actuel"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Ton mot de passe actuel"
                  />
                  <Input
                    label="Nouveau mot de passe"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 8 caractères"
                  />
                  <Input
                    label="Confirmer le nouveau mot de passe"
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Répète le nouveau mot de passe"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleChangePassword}
                    disabled={isChangingPassword || !currentPassword || !newPassword || !confirmNewPassword}
                  >
                    {isChangingPassword ? 'CHANGEMENT...' : 'CHANGER LE MOT DE PASSE'}
                  </Button>
                </div>

                <SectionTitle title="Vérification OTP" />
                <div className="hud-panel p-4 md:p-6 bg-zoyd-surface/20">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="font-display font-black text-white uppercase italic">Vérification par telephone</div>
                    <Badge variant="yellow">Bientôt</Badge>
                  </div>
                  <p className="text-sm text-white/70">
                    Le numéro {user.phone || 'non renseigné'} servira à confirmer certains retraits et actions sensibles.
                  </p>
                </div>

                {user.role === 'admin' ? (
                  <>
                    <SectionTitle title="Double authentification (admin)" />
                    <Admin2faSection />
                  </>
                ) : null}

                <SectionTitle title="En bref" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatusCard label="Fiabilité" value={`${user.trustScore}/100`} accent="text-zoyd-yellow" />
                  <StatusCard label="Solde affiche" value={user.walletBalance.toFixed(1) + ' ZC'} accent="text-white" />
                  <StatusCard label="Connexion" value={user.isOnline ? 'Active' : 'Hors ligne'} accent={user.isOnline ? 'text-green-400' : 'text-white/75'} />
                </div>
              </div>
            ) : null}

            {activeTab === 'gaming' ? (
              <div role="tabpanel" id="panel-gaming" aria-labelledby="tab-gaming">
                <SectionTitle title="Ton compte CODM" />
                <div className="grid md:grid-cols-2 gap-4">
                  <Input label="Game ID" value={user.gameId} disabled helperText="Ton identifiant CODM déjà lié à ce compte." />
                  <Input
                    label="Niveau CODM"
                    type="number"
                    value={String(form.levelCODM)}
                    onChange={(event) => updateForm('levelCODM', Number(event.target.value))}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <SelectField
                    label="Rank MJ"
                    value={form.rankMJ}
                    onChange={(value) => updateForm('rankMJ', value)}
                    options={CODM_RANGS.map((rank) => ({ value: rank, label: rank }))}
                  />
                  <SelectField
                    label="Rank BR"
                    value={form.rankBR}
                    onChange={(value) => updateForm('rankBR', value)}
                    options={CODM_RANGS.map((rank) => ({ value: rank, label: rank }))}
                  />
                </div>

                <SectionTitle title="Ton style de jeu" />
                <div className="grid md:grid-cols-2 gap-4">
                  <SelectField
                    label="Appareil principal"
                    value={form.device}
                    onChange={(value) => updateForm('device', value as SettingsForm['device'])}
                    options={DEVICE_OPTIONS.map((device) => ({ value: device.id, label: device.label }))}
                  />
                  <SelectField
                    label="Type de contrôle"
                    value={form.controllerType}
                    onChange={(value) => updateForm('controllerType', value as SettingsForm['controllerType'])}
                    options={CONTROLLER_OPTIONS.map((controller) => ({ value: controller.id, label: controller.label }))}
                  />
                </div>

                <div className="hud-panel p-5 bg-zoyd-surface/20">
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div className="font-display font-black text-white uppercase italic">Infos gardees privées</div>
                    <Badge variant="yellow">Privé</Badge>
                  </div>
                  <p className="text-sm text-white/70">
                    Ton appareil et ton type de contrôle servent seulement à mieux te proposer des matchs et tournois. Les autres joueurs ne les voient pas automatiquement.
                  </p>
                </div>
              </div>
            ) : null}

            {activeTab === 'notifications' ? (
              <div role="tabpanel" id="panel-notifications" aria-labelledby="tab-notifications">
                <SectionTitle title="Ce que tu veux recevoir" />
                <div className="space-y-3">
                  <NotificationRow
                    label="Debut de match"
                    desc="Rappel quand il est temps de confirmer ta presence et rejoindre la salle."
                    value={notificationToggles.matchStart}
                    onChange={(value) => setNotificationToggles((prev) => ({ ...prev, matchStart: value }))}
                  />
                  <NotificationRow
                    label="Résultats"
                    desc="Quand un score est confirmé ou qu'un gain arrive sur ton compte."
                    value={notificationToggles.results}
                    onChange={(value) => setNotificationToggles((prev) => ({ ...prev, results: value }))}
                  />
                  <NotificationRow
                    label="Messages"
                    desc="Nouvelle activité dans tes discussions d'équipe, de match ou privées."
                    value={notificationToggles.messages}
                    onChange={(value) => setNotificationToggles((prev) => ({ ...prev, messages: value }))}
                  />
                  <NotificationRow
                    label="Tournois"
                    desc="Quand ton prochain duel approche ou qu'un arbitre partage les infos utiles."
                    value={notificationToggles.tournaments}
                    onChange={(value) => setNotificationToggles((prev) => ({ ...prev, tournaments: value }))}
                  />
                  <NotificationRow
                    label="Parrainage"
                    desc="Des nouvelles de tes invitations et des bonus lies au partage."
                    value={notificationToggles.referrals}
                    onChange={(value) => setNotificationToggles((prev) => ({ ...prev, referrals: value }))}
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      markAllAsRead();
                      toast.success('Toutes les notifications ont été marquees comme lues.');
                    }}
                  >
                    Tout marquer comme lu
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-4 border-t border-white/5">
              <Button variant="primary" onClick={handleSave} disabled={isSaving}>
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'SAUVEGARDE...' : 'ENREGISTRER LES MODIFICATIONS'}
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

const SectionTitle = React.memo(({ title }: { title: string }) => (
  <h2 className="text-lg font-display font-black uppercase tracking-tighter italic border-b border-white/5 pb-2">
    {title}
  </h2>
));

const DangerZone: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [armed, setArmed] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!user || user.role === 'admin') return null;

  const handleDelete = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    if (!understood) {
      toast.error('Coche la case pour confirmer que tu comprends.');
      return;
    }
    setIsDeleting(true);
    try {
      const res = await deleteOwnAccount();
      toast.success(res.message || 'Compte supprimé.');
      logout();
      navigate('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mt-8 border border-red-500/40 bg-red-500/5 p-4">
      <div className="font-display font-black text-red-400 text-sm uppercase italic">Zone danger</div>
        <p className="text-[11px] font-mono text-white/60 uppercase tracking-widest mt-2 leading-relaxed">
          Supprimer ton compte est définitif : profil, amis, historique et messages anonymisés.
          Retire d'abord ton solde cash (minimum 150 ZC) et termine tes matchs en cours — tout solde restant sera
          abandonné.
        </p>
      <div className="mt-3 flex flex-col gap-3">
        {armed ? (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-red-500"
            />
            <span className="text-[11px] font-mono uppercase tracking-widest text-white/70">
              Je comprends, supprimer mon compte et abandonner mon solde restant
            </span>
          </label>
        ) : null}
        <div>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting || (armed && !understood)}
          >
            <AlertTriangle className="w-4 h-4 mr-2" />
            {isDeleting ? 'SUPPRESSION...' : armed ? 'CONFIRMER LA SUPPRESSION' : 'SUPPRIMER MON COMPTE'}
          </Button>
          {armed && !isDeleting ? (
            <button
              type="button"
              onClick={() => { setArmed(false); setUnderstood(false); }}
              className="ml-3 text-[11px] font-mono uppercase tracking-widest text-white/50 hover:text-white"
            >
              Annuler
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const Admin2faSection: React.FC = () => {
  const [status, setStatus] = useState<'loading' | 'disabled' | 'enabled' | 'error'>('loading');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState(30);
  // Mot de passe admin, exige une seule fois pour confirmer l enrolement 2FA.
  const [setupPassword, setSetupPassword] = useState('');
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  // Secondes restantes avant que le code affiche ne soit plus accepte.
  //
  // La fenetre TOTP est passee de 90 s a 30 s : c'est la bonne tradeoff pour
  // la securite, mais un code lu sur le telephone a la 28e seconde n'a plus
  // que 2 s. Sans ce decompte, l admin resubmitait en croyant a une panne.
  //
  // Calcule sur l horloge SERVEUR : c est celle qui valide. L horloge du
  // telephone peut deriver, celle du navigateur aussi — seule celle du
  // serveur fait foi.
  const [remaining, setRemaining] = useState<number | null>(null);
  const clockSkewRef = useRef(0);

  useEffect(() => {
    if (status !== 'enabled' || period <= 0) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const nowServer = Date.now() + clockSkewRef.current;
      const elapsed = Math.floor(nowServer / 1000) % period;
      // +1 parce que la seconde 0 existe deja.
      setRemaining(period - elapsed);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status, period]);

  useEffect(() => {
    let cancelled = false;
    fetchAdmin2faStatus()
      .then((res) => {
        if (cancelled) return;
        setStatus(res.enabled ? 'enabled' : 'disabled');
        if (res.period) setPeriod(res.period);
        // Mesure du decalage entre l horloge du navigateur et celle du
        // serveur, au moment de la reponse.
        if (typeof res.serverTime === 'number') {
          clockSkewRef.current = res.serverTime - Date.now();
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSetup = async () => {
    if (!setupPassword) {
      toast.error('Saisis ton mot de passe admin pour confirmer.');
      return;
    }
    setBusy(true);
    try {
      const res = await setupAdmin2fa(setupPassword);
      setSetupPassword('');
      const match = /secret=([A-Z2-7]+)/i.exec(res.otpauthUrl || '');
      if (!match) {
        toast.error('Secret introuvable dans la réponse.');
        return;
      }
      setSecret(match[1]);
      toast.success('Secret généré. Ajoute-le à ton appli authenticator.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de génération du secret.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async () => {
    if (code.trim().length < 6) {
      toast.error('Entre le code à 6 chiffres affiché par ton appli.');
      return;
    }
    setBusy(true);
    try {
      await enableAdmin2fa(code.trim());
      setStatus('enabled');
      setSecret('');
      setCode('');
      toast.success('Double authentification activée.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Code invalide.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (code.trim().length < 6) {
      toast.error('Entre le code à 6 chiffres affiché par ton appli.');
      return;
    }
    setBusy(true);
    try {
      await verifyAdmin2fa(code.trim());
      setCode('');
      setVerifiedAt(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      toast.success('Session vérifiée pour 5 minutes.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Code invalide.');
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('Secret copié.');
    } catch {
      toast.error('Copie impossible — recopie le secret à la main.');
    }
  };

  return (
    <div className="hud-panel p-4 md:p-6 bg-zoyd-surface/20 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="font-display font-black text-white uppercase italic">TOTP Admin</div>
        {status === 'enabled' ? (
          <Badge variant="success">Actif</Badge>
        ) : status === 'disabled' ? (
          <Badge variant="yellow">Inactif</Badge>
        ) : status === 'error' ? (
          <Badge variant="disabled">Erreur</Badge>
        ) : (
          <Badge variant="disabled">...</Badge>
        )}
      </div>

      <p className="text-sm text-white/70">
        Protège les opérations sensibles (crédits, arbitrages admin, rechargement). Utilise Google Authenticator ou Authy.
      </p>

      {status === 'disabled' ? (
        <div className="space-y-4">
          {!secret ? (
            <div className="space-y-2">
              <div className="max-w-md">
                <label htmlFor="admin2fa-setup-password" className="block text-[10px] font-mono font-black uppercase tracking-widest text-white/70 mb-2">
                  Confirme ton mot de passe admin
                </label>
                <Input
                  id="admin2fa-setup-password"
                  type="password"
                  autoComplete="current-password"
                  value={setupPassword}
                  onChange={(event) => setSetupPassword(event.target.value)}
                  placeholder="Mot de passe"
                  aria-label="Mot de passe admin, requis pour activer la double authentification"
                />
                <p className="text-[10px] text-white/50 mt-1">
                  Exigé : sans lui, un cookie volé suffirait à s'enrôler sa propre 2FA.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleSetup} disabled={busy}>
                {busy ? 'GÉNÉRATION...' : 'GÉNÉRER UN SECRET'}
              </Button>
            </div>
          ) : (
            <>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/70 mb-2">
                  1. Ajoute ce secret dans ton appli (saisie manuelle)
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <code className="flex-1 min-w-0 break-all bg-black border border-white/10 px-4 py-3 font-mono text-sm text-zoyd-yellow">
                    {secret}
                  </code>
                  <Button variant="secondary" size="sm" onClick={copySecret} aria-label="Copier le secret">
                    Copier
                  </Button>
                </div>
              </div>
              <div className="max-w-md">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/70 mb-2">
                  2. Entre le code à 6 chiffres affiché
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    aria-label="Code TOTP à 6 chiffres"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                  <Button variant="primary" size="sm" onClick={handleEnable} disabled={busy || code.trim().length < 6}>
                    {busy ? '...' : 'Activer'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {status === 'enabled' ? (
        <div className="space-y-3">
          <p className="text-sm text-white/70">
            Vérifie ta session avant chaque opération sensible (valable 5 minutes).
            {verifiedAt ? ` Dernière vérification : ${verifiedAt}.` : ''}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 max-w-md">
            <Input
              aria-label="Code TOTP à 6 chiffres"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
            <Button variant="primary" size="sm" onClick={handleVerify} disabled={busy || code.trim().length < 6}>
              {busy ? '...' : 'Vérifier'}
            </Button>
          </div>
          {remaining !== null && (
            <p
              className={`text-xs font-mono ${remaining <= 5 ? 'text-orange-400' : 'text-white/50'}`}
              role="status"
              aria-live="polite"
            >
              {remaining <= 5
                ? `Il expire dans ${remaining} s — attends le code suivant.`
                : `Code valide encore ${remaining} s.`}
            </p>
          )}
        </div>
      ) : null}

      {status === 'error' ? (
        <p className="text-sm text-red-400">Impossible de lire le statut 2FA. Recharge la page.</p>
      ) : null}
    </div>
  );
};

const SelectField = React.memo(({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) => (
  <label className="block space-y-2">
    <span className="block text-sm font-medium text-white">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="flex w-full border bg-white/5 px-4 py-3 text-base text-white border-white/20 focus:border-zoyd-yellow transition-all duration-200"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-zoyd-black text-white">
          {option.label}
        </option>
      ))}
    </select>
  </label>
));

const StatusCard = React.memo(({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className="hud-panel p-5 bg-zoyd-surface/20">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/70 mb-2">{label}</div>
    <div className={`font-display font-black italic ${accent}`}>{value}</div>
  </div>
));

const NotificationRow = React.memo(({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) => {
  const id = `notif-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="hud-panel p-4 bg-zoyd-surface/20 flex items-center justify-between gap-4">
      <label htmlFor={id} className="flex-1 cursor-pointer">
        <div className="font-display font-black text-white text-sm uppercase italic">{label}</div>
        <div className="text-[10px] font-mono text-white/70 mt-1">{desc}</div>
      </label>
      <input
        id={id}
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
        className="w-5 h-5 accent-zoyd-yellow"
      />
    </div>
  );
});

export default ParametresPage;
