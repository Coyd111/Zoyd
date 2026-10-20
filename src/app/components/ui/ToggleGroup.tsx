/**
 * ToggleGroup - groupe de boutons a deux etats (enveloppe Radix ToggleGroup).
 *
 * Sous-composants : Root, Item. Les items partagent une valeur unique (mode
 * exclusif) ou multiple.
 *
 * INVARIANT : `type` (single / multiple) decide si un seul item peut etre
 * actif. Un filtre qui doit pouvoir se decocher se comporte en single avec
 * la meme valeur sur le second clic, ou en multiple : le choix doit etre
 * delibere, sinon l'utilisateur ne peut plus tout desactiver.
 * PIEGE : la valeur groupee est un tableau en mode multiple : le lire comme
 * une chaine donne un resultat de filtre faux.
 * PIEGE : ce composant est utilise pour des filtres d'ecran : il ne doit
 * jamais declencher de requete par lui-meme.
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { type VariantProps } from "class-variance-authority";

import { cn } from "./utils";
import { toggleVariants } from "./Toggle";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
});

function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs",
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l",
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
