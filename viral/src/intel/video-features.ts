import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {firstSentence, sentences, wordCount} from '../core/text.js';
import {nowIso, parseJson} from '../core/util.js';
import {classifyCta, classifyHook, detectStructure, detectTopic, stripPreamble} from './features.js';
import {savePosts, analyzePosts, type NormalizedPost} from './store.js';

/**
 * Competitor VIDEO analysis from public metadata and public captions only (the videos are never downloaded nor
 * republished): duration, title, first sentence, what is said in the first 3 seconds, hook type, speech pace,
 * captions, music (original sound or a track), storytelling, structure, conclusion, call to action, statistics.
 * Editing rhythm and visual style cannot be measured without the video file: they are reported as such.
 */

export interface VideoFeatures {
  duration: number | null;
  title: string | null;
  firstSentence: string | null;
  first3s: string | null;
  first3sWords: number | null;
  hookType: string;
  wordsPerSecond: number | null;
  captions: 'oui' | 'non' | 'inconnu';
  music: {title: string | null; author: string | null; original: boolean | null};
  storytelling: number;
  structure: string;
  conclusion: 'question' | 'appel' | 'résumé' | 'chute' | 'inconnue';
  ctaType: string;
  editingRhythm: 'non mesuré (vidéo non téléchargée)';
  visualStyle: 'non mesuré (vidéo non téléchargée)';
  transcriptWords: number;
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

/** WebVTT / SRT captions → timed cues. */
export function parseCaptions(raw: string | null | undefined): Cue[] {
  if (!raw) return [];
  const out: Cue[] = [];
  const t = (s: string) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : NaN;
  };
  for (const block of raw.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) out.push({start: t(a), end: t(b), text});
  }
  return out.filter((c) => Number.isFinite(c.start));
}

const STORY = /\b(j'ai|je suis|il y a \d+|un jour|quand j|mon histoire|ma première|au début|résultat|depuis|elle a|il a)\b/gi;

export function videoFeatures(v: {duration?: number | null; title?: string | null; description?: string | null; transcript?: string | null; captionsAvailable?: boolean | null; music?: {title?: string | null; author?: string | null; original?: boolean | null}}): VideoFeatures {
  const cues = parseCaptions(v.transcript);
  const spoken = cues.length ? cues.map((c) => c.text).join(' ') : (v.transcript ?? '').replace(/WEBVTT[\s\S]*?\n\n/, '');
  const desc = stripPreamble(v.description ?? '');
  const first = cues.length ? firstSentence(spoken) : v.title ? firstSentence(v.title) : desc ? firstSentence(desc) : null;
  const early = cues.filter((c) => c.start < 3).map((c) => c.text).join(' ');
  const spokenSeconds = cues.length ? Math.max(0.5, cues[cues.length - 1].end - cues[0].start) : null;
  const words = wordCount(spoken);
  const last = sentences(spoken || desc).slice(-2).join(' ');
  const conclusion = /\?\s*$/.test(last) ? 'question' : /abonne|commente|lien|bio|enregistre|partage|clique|écris/i.test(last) ? 'appel' : /en résumé|retiens|donc|bref/i.test(last) ? 'résumé' : last ? 'chute' : 'inconnue';
  const all = `${v.title ?? ''} ${spoken} ${desc}`;
  const hookType = classifyHook(first ?? v.title ?? '');
  const musicTitle = v.music?.title ?? null;
  return {
    duration: v.duration ?? null,
    title: v.title ?? null,
    firstSentence: first,
    first3s: early || null,
    first3sWords: cues.length ? wordCount(early) : null,
    hookType,
    wordsPerSecond: spokenSeconds && words ? Math.round((words / spokenSeconds) * 100) / 100 : null,
    captions: cues.length || v.captionsAvailable ? 'oui' : v.captionsAvailable === false ? 'non' : 'inconnu',
    music: {title: musicTitle, author: v.music?.author ?? null, original: v.music?.original ?? (musicTitle ? /son original|original sound|sonido original|suono originale/i.test(musicTitle) : null)},
    storytelling: Math.min(1, (all.match(STORY)?.length ?? 0) / 4),
    structure: detectStructure(all, hookType as any, 'video', null),
    conclusion,
    ctaType: classifyCta(`${last} ${desc}`),
    editingRhythm: 'non mesuré (vidéo non téléchargée)',
    visualStyle: 'non mesuré (vidéo non téléchargée)',
    transcriptWords: words,
  };
}

/** ScrapeCreators (via Firecrawl Alexandria) answers: tiktok/video, youtube/video, youtube/search. */
export function fromVideoResponses(data: any): Array<{post: NormalizedPost; features: VideoFeatures}> {
  const items = Array.isArray(data) ? data : [data];
  const out: Array<{post: NormalizedPost; features: VideoFeatures}> = [];
  for (const it of items) {
    const d = it?.data ?? it;
    const aw = d?.aweme_detail;
    if (aw) {
      const st = aw.statistics ?? {};
      const music = aw.music ?? aw.added_sound_music_info ?? {};
      const durMs = aw.video?.duration ?? aw.duration;
      const f = videoFeatures({duration: durMs ? durMs / (durMs > 1000 ? 1000 : 1) : null, title: null, description: aw.desc, transcript: d.transcript, captionsAvailable: Array.isArray(aw.video?.cla_info?.caption_infos) ? aw.video.cla_info.caption_infos.length > 0 : null, music: {title: music.title, author: music.author ?? music.owner_nickname, original: music.is_original ?? music.original ?? null}});
      out.push({
        post: {platform: 'tiktok', externalId: String(aw.aweme_id), author: aw.author?.unique_id ?? null, url: `https://www.tiktok.com/@${aw.author?.unique_id}/video/${aw.aweme_id}`, publishedAt: aw.create_time ? new Date(aw.create_time * 1000).toISOString() : null, source: 'scrapecreators:tiktok/video', language: aw.desc_language ?? null, mediaType: 'video', durationS: f.duration, text: aw.desc ?? '', views: st.play_count ?? null, likes: st.digg_count ?? null, comments: st.comment_count ?? null, shares: st.share_count ?? null, saves: st.collect_count ?? null, followers: aw.author?.follower_count ?? null, isOwn: false} as NormalizedPost,
        features: f,
      });
      continue;
    }
    const yt = d?.title !== undefined && (d?.id || d?.videoId) ? d : null;
    if (yt) {
      const dur = typeof yt.lengthSeconds === 'number' ? yt.lengthSeconds : typeof yt.durationMs === 'number' ? yt.durationMs / 1000 : null;
      const f = videoFeatures({duration: dur, title: yt.title, description: yt.description, transcript: yt.transcript_only_text ?? yt.transcript ?? null, captionsAvailable: Array.isArray(yt.captionTracks) ? yt.captionTracks.length > 0 : null});
      out.push({
        post: {platform: 'youtube', externalId: String(yt.id ?? yt.videoId), author: yt.channel?.handle ?? yt.channel?.title ?? null, url: yt.url ?? `https://www.youtube.com/shorts/${yt.id ?? yt.videoId}`, publishedAt: yt.publishDate ?? null, source: 'scrapecreators:youtube/video', language: null, mediaType: 'video', durationS: f.duration, text: `${yt.title}\n${yt.description ?? ''}`, views: yt.viewCountInt ?? yt.viewCount ?? null, likes: yt.likeCountInt ?? yt.likeCount ?? null, comments: yt.commentCountInt ?? yt.commentCount ?? null, shares: null, saves: null, followers: null, isOwn: false} as NormalizedPost,
        features: f,
      });
    }
    for (const sh of d?.shorts ?? d?.videos ?? []) {
      if (!sh?.id || !sh?.title) continue;
      const f = videoFeatures({duration: sh.lengthSeconds ?? null, title: sh.title, description: sh.description ?? null});
      out.push({post: {platform: 'youtube', externalId: String(sh.id), author: sh.channel?.handle ?? sh.channel?.title ?? null, url: sh.url ?? `https://www.youtube.com/shorts/${sh.id}`, publishedAt: sh.publishedTime ?? null, source: 'scrapecreators:youtube/search', language: null, mediaType: 'video', durationS: sh.lengthSeconds ?? null, text: sh.title, views: sh.viewCountInt ?? null, likes: null, comments: null, shares: null, saves: null, followers: null, isOwn: false} as NormalizedPost, features: f});
    }
  }
  return out;
}

/** Saves the posts, then attaches the video features to them (features_json.video) and re-scores everything. */
export function importVideoAnalysis(db: Db, cfg: AppConfig, data: any): {videos: number; saved: unknown} {
  const rows = fromVideoResponses(data);
  const saved = savePosts(db, rows.map((r) => r.post));
  for (const r of rows) {
    const p = db.get<any>('SELECT id, features_json FROM posts WHERE platform = ? AND external_id = ?', r.post.platform, r.post.externalId);
    if (!p) continue;
    const fj = {...parseJson<any>(p.features_json, {}), video: r.features, videoAnalyzedAt: nowIso()};
    db.run('UPDATE posts SET features_json = ?, duration_s = COALESCE(?, duration_s), hook = COALESCE(?, hook) WHERE id = ?', JSON.stringify(fj), r.features.duration, r.features.firstSentence, p.id);
  }
  analyzePosts(db, cfg);
  // analyzePosts recomputes text features: put the video ones back.
  for (const r of rows) {
    const p = db.get<any>('SELECT id, features_json FROM posts WHERE platform = ? AND external_id = ?', r.post.platform, r.post.externalId);
    if (p && !parseJson<any>(p.features_json, {}).video) db.run('UPDATE posts SET features_json = ? WHERE id = ?', JSON.stringify({...parseJson<any>(p.features_json, {}), video: r.features}), p.id);
  }
  void detectTopic;
  return {videos: rows.length, saved};
}
