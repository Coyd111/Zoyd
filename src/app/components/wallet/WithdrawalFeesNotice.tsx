import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Avertissement sur les DEUX frais d'un retrait, avec possibilite de le
 * ne plus afficher.
 *
 * Pourquoi une fenetre dediee : avant, le recapitulatif affichait
 * « Frais (2 %) » puis « Tu recevras {net} ». Un joueur beninois pouvait lire
 * que son compte Mobile Money serait credite du net, alors que FedaPay
 * preleve EN PLUS ses propres frais de transfert sur le virement. La surprise
 * tombait apres coup, une fois l'argent parti.
 *
 * Point important : les 2 % sont la commission de ZOYD. Le taux applique par
 * FedaPay est distinct, preleve par FedaPay, et ne revient pas a ZOYD. On ne
 * donne volontairement aucun chiffre pour FedaPay : le taux est contractuel et
 * peut changer, un montant invente dans l'UI serait pire que silence.
 */

const STORAGE_KEY = 'zoyd:withdrawal-fees-notice-dismissed';

const readDismissed = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Navigation privee / cookies bloques : on affiche plutot que de cacher.
    return false;
  }
};

const writeDismissed = (value: boolean) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* preferences non persistees : l'avertissement reapparait, c'est sur */
  }
};

export const useWithdrawalFeesNoticeDismissed = () => {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setDismissed(event.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismissForever = () => {
    setDismissed(true);
    writeDismissed(true);
  };

  const showAgain = () => {
    setDismissed(false);
    writeDismissed(false);
  };

  return { dismissed, dismissForever, showAgain };
};

export const WithdrawalFeesNotice = ({
  zoydFeeRate,
  zoydFee,
  netAfterZoyd,
  onDismissForever,
}: {
  zoydFeeRate: number;
  zoydFee: number;
  netAfterZoyd: number;
  onDismissForever: () => void;
}) => {
  const percent = Math.round(zoydFeeRate * 10000) / 100;
  return (
    <section
      role="alert"
      aria-label="Frais applicables à un retrait"
      className="border-2 border-amber-400/40 bg-amber-400/5 p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-2 min-w-0">
          <h3 className="font-display font-black text-sm uppercase tracking-tight italic text-amber-400">
            Deux frais distincts, deux destinataires
          </h3>

          <div className="space-y-2 text-xs text-white/80 leading-relaxed">
            <p>
              <strong className="text-white">1. Commission ZOYD — {percent}&nbsp;% ({zoydFee} ZC)</strong>
              <br />
              Prélevée par ZOYD sur ton retrait. C&apos;est notre revenu, et elle est déjà
              déduite du montant ci-dessous.
            </p>
            <p>
              <strong className="text-white">2. Frais de transfert FedaPay</strong>
              <br />
              FedaPay prélève <strong className="text-white">son propre taux</strong> sur
              l&apos;envoi Mobile Money. Ce taux ne dépend pas de ZOYD et{' '}
              <strong className="text-white">ne nous revient pas</strong> : il est
              prélevé par FedaPay, en plus de la commission ci-dessus.
            </p>
            <p className="text-white/70">
              Le net affiché ({netAfterZoyd} ZC) est donc ce que ZOYD envoie à FedaPay.{' '}
              <strong className="text-amber-400">
                Le montant vraiment crédit sur ton numéro peut être inférieur
              </strong>
              , selon le taux appliqué par FedaPay. Demande le détail à ton opérateur
              Mobile Money pour connaître le montant final.
            </p>
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2 cursor-pointer select-none border-t border-amber-400/20 pt-3">
        {/*
          Non contrôlée volontairement : le composant est JAMAIS rendu quand
          l'avertissement est déjà masqué (le parent conditionne sur
          `dismissed`), donc pas besoin d'état. Avec `checked={false}` en
          permanence, la case était bloquée : impossible à cocher.
        */}
        <input
          type="checkbox"
          onChange={onDismissForever}
          className="mt-0.5 w-4 h-4 accent-amber-400 touch-target"
          aria-label="Ne plus afficher cet avertissement"
        />
        <span className="text-[10px] font-mono text-white/70 uppercase tracking-wider">
          Ne plus afficher ce message
        </span>
      </label>
    </section>
  );
};
