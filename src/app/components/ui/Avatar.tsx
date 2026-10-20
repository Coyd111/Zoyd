/**
 * Avatar - portrait du joueur avec repli (enveloppe Radix Avatar).
 *
 * Sous-composants : Root, Image, Fallback.
 *
 * INVARIANT : le Fallback est OBLIGATOIRE. Sans lui, un joueur sans photo
 * affiche un carre vide : l'initiale du pseudo est le repli prevu.
 * INVARIANT : le Fallback ne s'affiche qu'apres l'echec de chargement de
 * l'image : c'est le comportement de Radix, ne pas le court-circuiter.
 * PIEGE : le src peut casser ; le Fallback absorbe l'erreur. Ne pas
 * supprimer le Fallback "pour simplifier".
 * PIEGE : `alt` doit rester vide ou decoratif quand le pseudo est deja
 * affiche a cote, sinon le lecteur d'ecran repete l'information.
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "./utils";

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-10 shrink-0 overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };
