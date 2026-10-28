/**
 * chartColors - couleurs des graphiques Recharts.
 *
 * Les presentation attributes SVG (stopColor, stroke, fill) ne resolvent
 * PAS var() : la coherence avec le design system passe par ces constantes,
 * dont la valeur DOIT rester celle des tokens de src/styles/theme.css
 * (--color-yellow #FFFF00, --color-blue #0070FF). Changer le token change
 * la charte ; changer ces constantes ne fait que resynchroniser les
 * graphiques avec le reste de l'UI.
 *
 * P13 C10 (audit-3) : les graphiques utilisaient #FFCC00 et #009EE2 - deux
 * couleurs proches mais PAS celles du design system : la repartition des
 * matchs divergeait de la palette du reste de l'UI.
 *
 * Les couleurs de MARQUE tierces (MTN #FFCC00, Moov #009EE2 dans
 * payoutOperators.ts) ne sont PAS concernees : ce sont celles des logos
 * des operateurs, pas celles de ZOYD.
 */
export const CHART_YELLOW = '#FFFF00';
export const CHART_BLUE = '#0070FF';
