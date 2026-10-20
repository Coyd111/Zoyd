/**
 * RadioGroup - groupe de boutons radio (enveloppe Radix RadioGroup).
 *
 * Sous-composants : Root, Item, Indicator. Sibling oriente par la valeur.
 *
 * INVARIANT : les items d'un groupe se groupent par `name` implicite (le
 * Root) : deux groupes sur la meme page ne doivent pas partager la meme
 * valeur de depart.
 * INVARIANT : un seul item peut etre selectionne : c'est le contrat du
 * radio, pas un choix d'implementation.
 * PIEGE : dans un formulaire, la valeur doit etre branchee au controller
 * (react-hook-form) : ne pas lire l'etat interne de Radix.
 *
 * Voir aussi : docs/08-frontend.md - section 8 (Le design system)
 */
"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { CircleIcon } from "lucide-react";

import { cn } from "./utils";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
