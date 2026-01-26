/// <reference types="vite/client" />

declare module "*.csv?raw" {
  const content: string;
  export default content;
}

declare global {
  interface GoogleAccountsId {
    initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
    renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
    disableAutoSelect: () => void;
  }

  interface GoogleAccounts {
    id: GoogleAccountsId;
  }

  interface GoogleIdentity {
    accounts: GoogleAccounts;
  }

  interface Window {
    google?: GoogleIdentity;
  }
}

export {};
