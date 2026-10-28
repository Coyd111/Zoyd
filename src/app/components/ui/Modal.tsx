/**
 * Modal - fenetre modale maison (la, sans Radix), animee par motion.
 *
 * Gere l'ouverture, la fermeture par Echap, le piege de focus (Tab), le focus
 * initial, le rendu de l'arriere-plan et le retour du focus au declencheur.
 *
 * INVARIANT : le focus doit revenir au declencheur a la fermeture. Sans
 * cela, la navigation clavier repart au hasard dans la page.
 * INVARIANT : le focus initial est pose sur le PREMIER element focusable du
 * panneau, sinon sur le panneau lui-meme.
 * PIEGE : `onClose` est presque toujours une arrow function, donc une
 * nouvelle reference a chaque rendu. Le garder dans une ref evite de
 * rejouer l'effet a chaque frappe : le focus etait rendu au declencheur, le
 * champ perdait le focus et, sur mobile, le clavier se fermait a chaque
 * caractere saisi.
 * PIEGE : ce composant n'a pas de portail : s'il est rendu dans un conteneur
 * en `overflow-hidden`, il sera coupe.
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  // `onClose` est presque toujours une arrow function : nouvelle référence à
  // chaque rendu du parent. Le garder dans l'effet en dépendance faisait
  // rejouer l'effet à chaque frappe au clavier — le cleanup rendait le focus
  // au déclencheur, le champ perdait le focus, et sur mobile le clavier se
  // fermait à chaque caractère saisi. Une ref évite ce cycle sansmemforcer le
  // parent à memoïser ses callbacks.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  useEffect(() => {
    if (!isOpen) return;
    // Capturé à l'ouverture : le « déclencheur » est l'élément qui était actif
    // avant l'ouverture de la modale.
    triggerRef.current = document.activeElement;
    // Focus initial sur le panneau
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first || panelRef.current)?.focus();
    }, 60);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      // Focus trap minimal : Tab reste dans la modale
      if (event.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown, true);
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
    // Uniquement `isOpen` : toute autre dépendance rejoue le cleanup et donc
    // la restitution du focus, y compris pendant la saisie.
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            // P13 C6 (audit-3) : `bg-zoyd-black-80` n'existe pas - aucun token
            // d'opacite dans theme.css (@theme inline, :25-33), la classe ne
            // generait RIEN : le backdrop restait transparent + flou. L'opacite
            // arbitraire Tailwind est la convention du projet (BottomNav:79).
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? 'modal-title' : undefined}
              className={cn(
                'relative w-[calc(100%-2rem)] sm:w-full max-h-[85dvh] overflow-y-auto bg-zoyd-black border border-white/20 shadow-2xl pointer-events-auto safe-bottom',
                sizeClasses[size]
              )}
            >
              {/* Header */}
              {title && (
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                  <h2 id="modal-title" className="text-2xl font-display font-bold text-white">{title}</h2>
                  <button
                    onClick={onClose}
                    title="Fermer"
                    aria-label="Fermer"
                    className="touch-target p-2 hover:bg-white/5 transition-colors"
                  >
                    <X className="w-5 h-5 text-white" />
                  </button>
                </div>
              )}

              {/* Close button without title */}
              {!title && (
                <button
                  onClick={onClose}
                  title="Fermer"
                  aria-label="Fermer"
                  className="absolute top-4 right-4 touch-target p-2 hover:bg-white/5 transition-colors z-10"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Content */}
              <div className="p-6">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export { Modal };
