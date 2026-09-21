const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTorrentTitle, cleanReleaseNoise } = require('../torrentParser');

test('parses a standard 4K release', () => {
  const result = parseTorrentTitle('Dune.Part.Two.2024.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.7.1');
  assert.equal(result.title, 'Dune Part Two');
  assert.equal(result.year, 2024);
  assert.equal(result.resolution, '2160p');
  assert.equal(result.quality, 'BluRay');
  assert.equal(result.codec, 'HEVC');
  assert.equal(result.channels, '7.1');
});

test('detects season and episode without confusing the title', () => {
  const result = parseTorrentTitle('The.Bear.S03E04.1080p.WEB-DL.DDP5.1.H264');
  assert.equal(result.title, 'The Bear');
  assert.equal(result.seasonEpisode, 'S03E04');
  assert.equal(result.seasons[0], 3);
  assert.equal(result.episodes[0], 4);
});

test('keeps subtitle languages separate from spoken languages', () => {
  const result = parseTorrentTitle('Movie.2025.1080p.WEB-DL.Hindi.[Subs: English, Spanish]');
  assert.equal(result.languages.includes('Hindi'), true);
  assert.equal(result.subtitles.includes('English'), true);
  assert.equal(result.subtitles.includes('Spanish'), true);
  assert.equal(result.languages.includes('English'), false);
});

test('identifies multi-audio releases', () => {
  const result = parseTorrentTitle('Movie.2025.1080p.WEB-DL.Multi-Audio.Hindi.English.Tamil');
  assert.equal(result.isMultiAudio, true);
  assert.equal(result.languages.includes('Multi-Audio'), true);
});

test('removes common release noise without destroying the title', () => {
  assert.equal(cleanReleaseNoise('www.example.com - Movie.2025.1080p.mkv'), 'Movie.2025.1080p');
});
