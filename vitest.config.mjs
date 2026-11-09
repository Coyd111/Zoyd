// Vitest — tests ciblés argent (dépôt, retrait, refund, purge orpheline).
// Mode mémoire obligatoire : jamais de réseau ni de base en test.
process.env.ZOYD_DISABLE_SUPABASE = 'true';

export default {
  test: {
    environment: 'node',
    include: ['server/**/*.test.mjs'],
    globals: false,
  },
};
