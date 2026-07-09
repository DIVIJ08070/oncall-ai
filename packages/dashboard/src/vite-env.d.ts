/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Platform base URL (SPEC §6/§14). Default `http://localhost:3001`. */
  readonly PUBLIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
