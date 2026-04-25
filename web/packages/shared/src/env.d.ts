interface ImportMetaEnv {
  readonly VITE_NAKAMA_HOST?: string;
  readonly VITE_NAKAMA_PORT?: string;
  readonly VITE_NAKAMA_BASE_URL?: string;
  readonly VITE_NAKAMA_USE_SSL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
