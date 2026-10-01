import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYoutubeVideoId } from '../src/services/community/officialVideoService.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

test('parseYoutubeVideoId accepts supported HTTPS YouTube URLs', () => {
  const urls = [
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}?si=example`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
    `https://youtube.com/shorts/${VIDEO_ID}`,
    `https://m.youtube.com/live/${VIDEO_ID}`,
    VIDEO_ID,
  ];

  for (const url of urls) assert.equal(parseYoutubeVideoId(url), VIDEO_ID);
});

test('parseYoutubeVideoId rejects unsafe or malformed values', () => {
  const values = [
    `http://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtube.com.evil.example/watch?v=${VIDEO_ID}`,
    'https://www.youtube.com/playlist?list=PL123',
    'https://youtu.be/too-short',
    'not a URL',
    '',
  ];

  for (const value of values) {
    assert.throws(() => parseYoutubeVideoId(value));
  }
});
