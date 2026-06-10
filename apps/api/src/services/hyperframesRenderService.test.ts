import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ensureRootDuration, stripHtmlFences } from './hyperframesAuthor';
import { hyperframesRenderEnabled, validateComposition } from './hyperframesRenderService';
import { getDemoAssetDir } from './videoPaths';

// A real assets dir with known files (no temp writes): the demo asset folder.
const assetsDir = path.join(getDemoAssetDir(), 'kangshifu_iced_tea');
const REAL = 'kangshifu-iced-tea-splash.png';

test('hyperframesRenderEnabled: explicit override + env default (off unless "true")', () => {
  assert.equal(hyperframesRenderEnabled(true), true);
  assert.equal(hyperframesRenderEnabled(false), false);
  const prev = process.env.USE_HYPERFRAMES_RENDER;
  try {
    delete process.env.USE_HYPERFRAMES_RENDER;
    assert.equal(hyperframesRenderEnabled(), false);
    process.env.USE_HYPERFRAMES_RENDER = 'true';
    assert.equal(hyperframesRenderEnabled(), true);
    process.env.USE_HYPERFRAMES_RENDER = '1';
    assert.equal(hyperframesRenderEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.USE_HYPERFRAMES_RENDER;
    else process.env.USE_HYPERFRAMES_RENDER = prev;
  }
});

test('validateComposition: accepts only local ./assets files that exist', () => {
  const html = `<img src="./assets/${REAL}" /><div style="background:url('assets/${REAL}')"></div>`;
  const r = validateComposition(html, assetsDir);
  assert.equal(r.ok, true, r.violations.join('; '));
});

test('validateComposition: rejects external image URLs (honesty gate)', () => {
  const html = `<img src="https://cdn.example.com/fake-product.png" />`;
  const r = validateComposition(html, assetsDir);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('non-local')));
});

test('validateComposition: rejects data: images and missing local assets', () => {
  const dataUri = validateComposition('<img src="data:image/png;base64,AAAA" />', assetsDir);
  assert.equal(dataUri.ok, false);
  const missing = validateComposition('<img src="./assets/does-not-exist.png" />', assetsDir);
  assert.equal(missing.ok, false);
  assert.ok(missing.violations.some((v) => v.includes('missing asset')));
});

test('validateComposition: ignores the GSAP CDN <script src> (not a media ref)', () => {
  const html = `<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script><img src="./assets/${REAL}" />`;
  const r = validateComposition(html, assetsDir);
  assert.equal(r.ok, true, r.violations.join('; '));
});

test('stripHtmlFences: unwraps ```html fences and trims to <!DOCTYPE…</html>', () => {
  const wrapped = '```html\n<!DOCTYPE html><html><body>hi</body></html>\n```';
  assert.equal(stripHtmlFences(wrapped), '<!DOCTYPE html><html><body>hi</body></html>');
  const noisy = 'Sure!\n<!DOCTYPE html><html><body>x</body></html>\nHope that helps.';
  assert.equal(stripHtmlFences(noisy), '<!DOCTYPE html><html><body>x</body></html>');
});

test('ensureRootDuration: inserts data-duration = last clip end when missing (prevents black tail)', () => {
  const html =
    '<div data-composition-id="ad" data-start="0" data-width="1080" data-height="1920">' +
    '<div class="clip" data-start="0" data-duration="2.6"></div>' +
    '<div class="clip" data-start="12.0" data-duration="4.0"></div>' +
    '</div>';
  const out = ensureRootDuration(html);
  assert.match(out, /data-composition-id="ad" data-duration="16"/);
});

test('ensureRootDuration: corrects an over-long data-duration down to content end', () => {
  const html =
    '<div data-composition-id="ad" data-duration="19.3" data-start="0" data-width="1080" data-height="1920">' +
    '<div class="clip" data-start="4" data-duration="2.5"></div>' +
    '</div>';
  const out = ensureRootDuration(html);
  assert.match(out, /data-duration="6.5"/);
  assert.doesNotMatch(out, /data-duration="19.3"/);
});

test('ensureRootDuration: ignores the root div itself and non-numeric clip starts', () => {
  const html =
    '<div data-composition-id="ad" data-start="0" data-width="1080" data-height="1920">' +
    '<div class="clip" data-start="el-1" data-duration="3"></div>' + // clip-id ref → skipped
    '<div class="clip" data-start="1.5" data-duration="2"></div>' + // ends at 3.5
    '</div>';
  const out = ensureRootDuration(html);
  assert.match(out, /data-duration="3.5"/);
});

test('ensureRootDuration: no-op when no root or no numeric clips found', () => {
  const noRoot = '<div class="clip" data-start="0" data-duration="3"></div>';
  assert.equal(ensureRootDuration(noRoot), noRoot);
  const noClips = '<div data-composition-id="ad" data-start="0" data-width="1080" data-height="1920"></div>';
  assert.equal(ensureRootDuration(noClips), noClips);
});
