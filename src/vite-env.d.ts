/// <reference types="vite/client" />

declare module "*.csv?raw" {
  const content: string;
  export default content;
}

declare global {
  interface GoogleTokenResponse {
    access_token?: string;
    expires_in?: number;
    error?: string;
  }

  interface GoogleTokenClient {
    requestAccessToken: (options?: { prompt?: "" | "consent" | "select_account" | "none" }) => void;
  }

  interface GoogleOauth2 {
    initTokenClient: (config: {
      client_id: string;
      scope: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback?: () => void;
    }) => GoogleTokenClient;
  }

  interface GoogleAccountsId {
    initialize: (config: {
      client_id: string;
      callback: (response: { credential: string }) => void;
      use_fedcm_for_button?: boolean;
    }) => void;
    renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
    disableAutoSelect: () => void;
  }

  interface GoogleAccounts {
    id: GoogleAccountsId;
    oauth2?: GoogleOauth2;
  }

  interface GoogleIdentity {
    accounts: GoogleAccounts;
  }

  interface Window {
    google?: GoogleIdentity;
  }
}

export {};
