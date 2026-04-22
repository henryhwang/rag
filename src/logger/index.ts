// ============================================================
// Logger interface and default no-op implementation
// ============================================================

import { type Logger } from '../types/index.ts';

/** Silent logger — outputs nothing. Default for RAGConfig. */
export class NoopLogger implements Logger {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debug(_msg: string, ..._args: unknown[]): void { }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  info(_msg: string, ..._args: unknown[]): void { }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  warn(_msg: string, ..._args: unknown[]): void { }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  error(_msg: string, ..._args: unknown[]): void { }
}

export type { Logger };
