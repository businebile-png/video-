import {spawn} from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command without a shell (no quoting pitfalls); never throws on non-zero exit. */
export function run(cmd: string, args: string[], opts: {cwd?: string; input?: string; env?: NodeJS.ProcessEnv} = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({code: code ?? 1, stdout, stderr}));
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function runOrThrow(cmd: string, args: string[], opts: {cwd?: string; input?: string; env?: NodeJS.ProcessEnv} = {}): Promise<ExecResult> {
  const res = await run(cmd, args, opts);
  if (res.code !== 0) {
    const tail = (res.stderr || res.stdout).split('\n').slice(-12).join('\n');
    throw new Error(`Échec de « ${cmd} ${args.slice(0, 6).join(' ')} … » (code ${res.code}) :\n${tail}`);
  }
  return res;
}

export const ffmpeg = (args: string[]) => runOrThrow('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args]);

export interface ProbeStream {
  codec_type: 'video' | 'audio' | string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<Record<string, unknown>>;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: {duration?: string; bit_rate?: string; size?: string; format_name?: string};
}

export async function ffprobe(file: string): Promise<ProbeResult> {
  const res = await runOrThrow('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  return JSON.parse(res.stdout) as ProbeResult;
}

export function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split('/').map(Number);
  if (!n || !d) return Number(rate) || 0;
  return n / d;
}

/** Rotation metadata makes a 1920x1080 file display as portrait; account for it. */
export function displayDims(stream: ProbeStream): {width: number; height: number} {
  const w = stream.width ?? 0;
  const h = stream.height ?? 0;
  const rotTag = Number(stream.tags?.rotate ?? 0);
  const rotSide = Number((stream.side_data_list?.find((s) => 'rotation' in s)?.rotation as number | undefined) ?? 0);
  const rot = Math.abs(rotTag || rotSide) % 180;
  return rot === 90 ? {width: h, height: w} : {width: w, height: h};
}
