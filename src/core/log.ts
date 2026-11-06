import fs from 'node:fs';
import path from 'node:path';

type Level = 'info' | 'warn' | 'error' | 'ok' | 'step';

const ICON: Record<Level, string> = {info: '·', warn: '!', error: '✗', ok: '✓', step: '▶'};

let runLogFile: string | null = null;

/** Mirror every log line into runs/<id>/logs.jsonl once a run is known. */
export function attachRunLog(file: string): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  runLogFile = file;
}

function write(level: Level, message: string, data?: Record<string, unknown>): void {
  const line = `${ICON[level]} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (runLogFile) {
    const rec = {at: new Date().toISOString(), level, message, ...(data ? {data} : {})};
    try {
      fs.appendFileSync(runLogFile, JSON.stringify(rec) + '\n');
    } catch {
      // Logging must never break a production step.
    }
  }
}

export const log = {
  info: (m: string, d?: Record<string, unknown>) => write('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => write('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => write('error', m, d),
  ok: (m: string, d?: Record<string, unknown>) => write('ok', m, d),
  step: (m: string, d?: Record<string, unknown>) => write('step', m, d),
};
