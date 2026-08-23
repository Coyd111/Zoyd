import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Bell, Gamepad2, Save, Shield, User } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore, type User as AuthUser } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { updateServerAccount } from '../lib/authApi';
import { CODM_RANKS, CONTROLLER_OPTIONS, COUNTRY_OPTIONS, DEVICE_OPTIONS } from '../../lib/competition';

const tabs = [
  { id: 'account', label: 'COMPTE', icon: User },
  { id: 'security', label: 'SECURITE', icon: Shield },
  { id: 'gaming', label: 'GAMING', icon: Gamepad2 },
  { id: 'notifications', label: 'NOTIFICATIONS', icon: Bell },
] as const;

type ActiveTab = (typeof tabs)[number]['id'];

type SettingsForm = Pick<
  AuthUser,
  | 'phone'
  | 'country'
  | 'bio'
  | 'streamerMode'
  | 'streamerPseudo'
  | 'controllerType'
  | 'device'
  | 'levelCODM'
  | 'rankMJ'
  | 'rankBR'
>;

type NotificationSettings = {
  matchStart: boolean;
  results: boolean;
  messages: boolean;
  tournaments: boolean;
  referrals: boolean;
};

const ParametresPage: React.FC = () => {
  const { user, updateUser } = useAuthStore();
  const { markAllAsRead } = useNotificationStore();
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

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      phone: user.phone,
      country: user.country,
      bio: user.bio || '',
      streamerMode: user.streamerMode,
      streamerPseudo: user.streamerPseudo || '',
      controllerType: user.controllerType,
      device: user.device,
      levelCODM: user.levelCODM,
      rankMJ: user.rankMJ,
      rankBR: user.rankBR,
    });
    // Load notification settings from user.notifications if available
    if (user.notifications && typeof user.notifications === 'object') {
      setNotificationToggles({
        matchStart: user.notifications.matchStart ?? true,
        results: user.notifications.results ?? true,
        messages: user.notifications.messages ?? true,
        tournaments: user.notifications.tournaments ?? true,
        referrals: user.notifications.referrals ?? false,
      });
    }
  }, [user]);

  if (!user || !form) {
    return (
      <div className="min-h-dvh bg-zoyd-black text-white flex items-center justify-center safe-top">
        <div className="text-center">
          <h2 className="text-2xl font-display font-black uppercase mb-4">Parametres indisponibles</h2>
        </div>
      </div>
    );
  }

  const updateForm = <K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates = {
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
      const response = await updateServerAccount(updates);
      if (response.ok) {
        updateUser(response.user);
        toast.success('Tes préférences ont bien été enregistrées.');
      }
    } catch {
      toast.error('Erreur lors de la sauvegarde de tes paramètres.');
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
      toast.error('Le nouveau mot de passe doit faire au moins 8 caracteres.');
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
        toast.success('Mot de passe change avec succes.');
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
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 pt-16 overflow-hidden">
        <img src="/assets/images/codm-4.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
        <img src="/assets/images/codm-5.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-[1240px] mx-auto px-4 sm:px-6 md:px-8 pb-12">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-display font-black uppercase tracking-tighter italic leading-none">
            Parametres
          </h1>
          <p className="text-white/40 mt-4 max-w-2xl">
            Regle ton profil, ton compte CODM et ce que ZOYD doit prendre en compte pour te proposer les bonnes parties.
          </p>
        </div>
      </header>

      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12 grid grid-cols-1 lg:grid-cols-4 gap-8 relative z-10">
        <div className="lg:col-span-1 space-y-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-4 px-4 py-3.5 touch-target font-display font-black text-xs tracking-widest italic uppercase transition-all ${
                  isActive
                    ? 'bg-white text-black shadow-[4px_0_0_0_#FFE600]'
                    : 'text-white/40 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}

          <div className="hud-panel p-4 mt-6 bg-red-500/5 border-red-500/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" />
              <div>
                <h4 className="text-[10px] font-mono font-black uppercase tracking-widest text-red-400 mb-1">
                  A savoir
                </h4>
                <p className="text-[10px] font-mono text-white/30">
                  Ce que tu changes ici peut modifier les matchs et tournois qui te sont proposes, ainsi que ce que les autres voient sur ton profil.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-8"
          >
            {activeTab === 'account' ? (
              <>
                <SectionTitle title="Ton compte" />
                <div className="grid md:grid-cols-2 gap-4">
                  <Input label="Pseudo" value={user.pseudo} disabled helperText="Le nom qui t'identifie sur ZOYD." />
                  <Input label="Email" value={user.email} disabled helperText="Ton email de connexion." />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <Input
                    label="Telephone"
                    value={form.phone}
                    onChange={(event) => updateForm('phone', event.target.value)}
                    helperText="Utile pour verifier ton compte et recevoir tes retraits."
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
                  <label className="block space-y-2">
                    <span className="block text-sm font-medium text-white">Bio</span>
                    <textarea
                      value={form.bio}
                      onChange={(event) => updateForm('bio', event.target.value)}
                      rows={4}
                      className="flex w-full border bg-white/5 px-4 py-3 text-base text-white border-white/20 placeholder:text-white/30 focus:outline-none focus:border-zoyd-yellow transition-all duration-200"
                      placeholder="Quelques lignes pour decrire ton style de jeu ou ton identite competitive."
                    />
                  </label>

                  <div className="hud-panel p-4 bg-zoyd-surface/20 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <div className="font-display font-black text-white text-sm uppercase italic">Mode streamer</div>
                      <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest mt-1">
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
              </>
            ) : null}

            {activeTab === 'security' ? (
              <>
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
                    placeholder="Minimum 8 caracteres"
                  />
                  <Input
                    label="Confirmer le nouveau mot de passe"
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Repete le nouveau mot de passe"
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

                <SectionTitle title="Verification OTP" />
                <div className="hud-panel p-6 bg-zoyd-surface/20">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="font-display font-black text-white uppercase italic">Verification par telephone</div>
                    <Badge variant="yellow">Bientot</Badge>
                  </div>
                  <p className="text-sm text-white/40">
                    Le numero {user.phone || 'non renseigne'} servira a confirmer certains retraits et actions sensibles.
                  </p>
                </div>

                <SectionTitle title="En bref" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatusCard label="Fiabilite" value={`${user.trustScore}/100`} accent="text-zoyd-yellow" />
                  <StatusCard label="Solde affiche" value={user.walletBalance.toFixed(1) + ' ZC'} accent="text-white" />
                  <StatusCard label="Connexion" value={user.isOnline ? 'Active' : 'Hors ligne'} accent={user.isOnline ? 'text-green-400' : 'text-white/50'} />
                </div>
              </>
            ) : null}

            {activeTab === 'gaming' ? (
              <>
                <SectionTitle title="Ton compte CODM" />
                <div className="grid md:grid-cols-2 gap-4">
                  <Input label="Game ID" value={user.gameId} disabled helperText="Ton identifiant CODM deja lie a ce compte." />
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
                    options={CODM_RANKS.map((rank) => ({ value: rank, label: rank }))}
                  />
                  <SelectField
                    label="Rank BR"
                    value={form.rankBR}
                    onChange={(value) => updateForm('rankBR', value)}
                    options={CODM_RANKS.map((rank) => ({ value: rank, label: rank }))}
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
                    label="Type de controle"
                    value={form.controllerType}
                    onChange={(value) => updateForm('controllerType', value as SettingsForm['controllerType'])}
                    options={CONTROLLER_OPTIONS.map((controller) => ({ value: controller.id, label: controller.label }))}
                  />
                </div>

                <div className="hud-panel p-5 bg-zoyd-surface/20">
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div className="font-display font-black text-white uppercase italic">Infos gardees privees</div>
                    <Badge variant="yellow">Prive</Badge>
                  </div>
                  <p className="text-sm text-white/40">
                    Ton appareil et ton type de controle servent seulement a mieux te proposer des matchs et tournois. Les autres joueurs ne les voient pas automatiquement.
                  </p>
                </div>
              </>
            ) : null}

            {activeTab === 'notifications' ? (
              <>
                <SectionTitle title="Ce que tu veux recevoir" />
                <div className="space-y-3">
                  <NotificationRow
                    label="Debut de match"
                    desc="Rappel quand il est temps de confirmer ta presence et rejoindre la salle."
                    value={notificationToggles.matchStart}
                    onChange={(value) => setNotificationToggles((prev) => ({ ...prev, matchStart: value }))}
                  />
                  <NotificationRow
                    label="Resultats"
                    desc="Quand un score est confirme ou qu'un gain arrive sur ton compte."
                    value={notificationToggles.results}
                    onChange={(value) => setNotificationToggles((prev) => ({ ...prev, results: value }))}
                  />
                  <NotificationRow
                    label="Messages"
                    desc="Nouvelle activite dans tes discussions d'equipe, de match ou privees."
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
                      toast.success('Toutes les notifications ont ete marquees comme lues.');
                    }}
                  >
                    Tout marquer comme lu
                  </Button>
                </div>
              </>
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

const SectionTitle = ({ title }: { title: string }) => (
  <h2 className="text-lg font-display font-black uppercase tracking-tighter italic border-b border-white/5 pb-2">
    {title}
  </h2>
);

const SelectField = ({
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
      className="flex w-full border bg-white/5 px-4 py-3 text-base text-white border-white/20 focus:outline-none focus:border-zoyd-yellow transition-all duration-200"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-zoyd-black text-white">
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

const StatusCard = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className="hud-panel p-5 bg-zoyd-surface/20">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">{label}</div>
    <div className={`font-display font-black italic ${accent}`}>{value}</div>
  </div>
);

const NotificationRow = ({
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
        <div className="text-[10px] font-mono text-white/30 mt-1">{desc}</div>
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
};

export default ParametresPage;
