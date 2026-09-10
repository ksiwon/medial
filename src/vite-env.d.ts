/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "1" to include the archived companion demo in the build. Off by
   *  default so the active bundle carries only the research simulator. */
  readonly VITE_INCLUDE_COMPANION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
