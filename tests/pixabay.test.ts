import {describe, expect, it} from 'vitest';
import {pixabayToVideo, type PixabayHit} from '../src/footage/pixabay.js';
import {pickFile} from '../src/footage/footage-step.js';
import {loadConfig} from '../src/core/config.js';
import {redactUrl} from '../src/core/http.js';

const hit: PixabayHit = {
  id: 125,
  pageURL: 'https://pixabay.com/videos/id-125/',
  type: 'film',
  tags: 'laptop, work, desk',
  duration: 14,
  videos: {
    large: {url: 'https://cdn.pixabay.com/video/2024/01/01/125-large.mp4', width: 2160, height: 3840, size: 9_000_000, thumbnail: 'https://cdn.pixabay.com/video/2024/01/01/125-large.jpg'},
    medium: {url: 'https://cdn.pixabay.com/video/2024/01/01/125-medium.mp4', width: 1080, height: 1920, size: 4_000_000, thumbnail: 'https://cdn.pixabay.com/video/2024/01/01/125-medium.jpg'},
    small: {url: '', width: 0, height: 0, size: 0},
    tiny: {url: 'https://cdn.pixabay.com/video/2024/01/01/125-tiny.mp4', width: 540, height: 960, size: 600_000},
  },
  user_id: 42,
  user: 'Jane',
};

describe('Pixabay', () => {
  it('maps a search hit to the common video shape', () => {
    const v = pixabayToVideo(hit)!;
    expect(v.id).toBe(125);
    expect(v.url).toBe('https://pixabay.com/videos/id-125/');
    expect(v.image).toContain('125-medium.jpg');
    expect(v.video_files.map((f) => f.quality)).toEqual(['large', 'medium', 'tiny']);
    expect(v.user.url).toBe('https://pixabay.com/users/Jane-42/');
  });

  it('picks a vertical rendition of at least 1080 px', async () => {
    const config = await loadConfig();
    const file = pickFile(pixabayToVideo(hit)!, config.footage)!;
    expect(file.width).toBe(1080);
    expect(file.height).toBe(1920);
  });

  it('skips hits without any usable file', () => {
    expect(pixabayToVideo({...hit, videos: {small: {url: '', width: 0, height: 0, size: 0}}})).toBeNull();
  });

  it('never shows the key in error messages', () => {
    expect(redactUrl('https://pixabay.com/api/videos/?key=12345-abcdef&q=laptop')).toBe('https://pixabay.com/api/videos/?key=***&q=laptop');
  });
});

describe('pertinence des séquences', () => {
  it('rejects clips whose tags share no word with the search', async () => {
    const {keywordOverlap, queryTerms} = await import('../src/footage/footage-step.js');
    expect(queryTerms('hands typing laptops')).toEqual(['hand', 'typing', 'laptop']);
    expect(keywordOverlap(['bacon', 'meat', 'food'], 'creator working desk lamp night')).toBe(0);
    expect(keywordOverlap(['woman', 'laptop', 'work'], 'woman laptop night')).toBe(2);
    expect(keywordOverlap(undefined, 'anything')).toBeNull();
  });
});
