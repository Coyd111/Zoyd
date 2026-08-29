/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REALTIME_URL?: string;
  readonly VITE_FEDAPAY_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const FedaPay: {
  checkout: (options: {
    public_key: string;
    transaction: { amount: number; description: string };
    customer: { email: string; lastname: string };
    onComplete: (resp: { reason?: string; transaction?: { id: number | string } }) => void;
  }) => void;
} | undefined;
