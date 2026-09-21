import assert from 'node:assert/strict';
import test from 'node:test';
import { spectrogramColor, createSpectrogramPalette } from '../js/atlas/signal-atlas-color.js';
import { ATLAS_COLORS, ATLAS_COLOR_DEFAULTS, ATLAS_COLOR_PRESETS, matchingAtlasColorPreset, resolveAtlasColors } from '../js/atlas/signal-atlas-palette.js';

test('spectrogram palette matches reference colors and interpolates in display RGB', () => {
  for (const [level, expected] of [[0, [4, 3, 12]], [.15, [14, 10, 42]], [.30, [45, 12, 95]],
    [.45, [110, 20, 130]], [.60, [185, 30, 85]], [.75, [230, 80, 25]],
    [.88, [255, 175, 20]], [.96, [255, 235, 80]], [1, [255, 255, 240]]]) {
    assert.deepEqual(spectrogramColor(level), expected);
  }
  assert.deepEqual(spectrogramColor(.075), [9, 7, 27]);
  assert.deepEqual(spectrogramColor(-1), [4, 3, 12]);
  assert.deepEqual(spectrogramColor(2), [255, 255, 240]);
  assert.deepEqual(spectrogramColor(NaN), [4, 3, 12]);
});

test('palette texture contains 1024 opaque colors including both endpoints', () => {
  const palette = createSpectrogramPalette();
  assert.equal(palette.length, 4096);
  assert.deepEqual([...palette.subarray(0, 4)], [4, 3, 12, 255]);
  assert.deepEqual([...palette.subarray(-4)], [255, 255, 240, 255]);
  assert.ok(palette.every((value, index) => index % 4 !== 3 || value === 255));
});

test('default colour settings reproduce the original palette exactly', () => {
  assert.deepEqual(createSpectrogramPalette(ATLAS_COLOR_DEFAULTS), createSpectrogramPalette());
  assert.deepEqual(createSpectrogramPalette({}), createSpectrogramPalette());
  assert.deepEqual(resolveAtlasColors(ATLAS_COLOR_DEFAULTS), ATLAS_COLORS);
});

test('spectrogram pickers set their anchors while retaining the dark floor', () => {
  const settings = { colorSpectrogramLow: '#123456', colorSpectrogramMid: '#789abc', colorSpectrogramHigh: '#def012' };
  assert.deepEqual(spectrogramColor(.30, settings), [18, 52, 86]);
  assert.deepEqual(spectrogramColor(.75, settings), [120, 154, 188]);
  assert.deepEqual(spectrogramColor(1, settings), [222, 240, 18]);
  assert.deepEqual(spectrogramColor(0, settings), spectrogramColor(0));
  assert.notDeepEqual(createSpectrogramPalette(settings), createSpectrogramPalette());
  assert.deepEqual(createSpectrogramPalette({ colorSpectrogramLow: 'invalid', colorSpectrogramMid: null,
    colorSpectrogramHigh: '#fff' }), createSpectrogramPalette());
});

test('main colour settings leave semantic meter colours and other instances independent', () => {
  const colors = resolveAtlasColors({ colorPrimary: '#123456', colorAccent: '#abcdef', colorText: '#fedcba', colorGuides: '#567890' });
  assert.deepEqual([colors.ivory, colors.copper, colors.pearl, colors.silver], ['#123456', '#ABCDEF', '#FEDCBA', '#567890']);
  for (const key of ['black', 'white', 'olive', 'amber', 'coral']) assert.equal(colors[key], ATLAS_COLORS[key]);
  assert.deepEqual(resolveAtlasColors({ colorPrimary: 'invalid', colorAccent: '#fff' }), ATLAS_COLORS);
  assert.deepEqual(resolveAtlasColors({}), ATLAS_COLORS);
});

test('colour presets supply seven valid colours and preserve the original palette', () => {
  assert.deepEqual(Object.keys(ATLAS_COLOR_PRESETS), ['original', 'ocean', 'aurora', 'ember', 'violet']);
  assert.equal(ATLAS_COLOR_PRESETS.original.colors, ATLAS_COLOR_DEFAULTS);
  assert.ok(Object.isFrozen(ATLAS_COLOR_PRESETS));
  for (const [key, preset] of Object.entries(ATLAS_COLOR_PRESETS)) {
    assert.ok(preset.label.length > 0);
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.colors));
    assert.deepEqual(Object.keys(preset.colors), Object.keys(ATLAS_COLOR_DEFAULTS));
    for (const color of Object.values(preset.colors)) assert.match(color, /^#[\dA-F]{6}$/);
    assert.equal(matchingAtlasColorPreset(preset.colors), key);
    const palette = createSpectrogramPalette(preset.colors);
    assert.equal(palette.length, 4096);
    assert.deepEqual([...palette.subarray(0, 4)], [4, 3, 12, 255]);
    if (key === 'original') assert.deepEqual(palette, createSpectrogramPalette());
    else assert.notDeepEqual(palette, createSpectrogramPalette());
  }
});

test('preset matching accepts case differences and ignores unrelated settings', () => {
  for (const [key, preset] of Object.entries(ATLAS_COLOR_PRESETS)) {
    const settings = Object.fromEntries(Object.entries(preset.colors).map(([name, value]) => [name, value.toLowerCase()]));
    settings.gain = 1.4;
    settings.labels = false;
    assert.equal(matchingAtlasColorPreset(settings), key);
  }
});

test('preset matching detects custom changes in every colour and resolves absent defaults', () => {
  assert.equal(matchingAtlasColorPreset(), 'original');
  assert.equal(matchingAtlasColorPreset({}), 'original');
  assert.equal(matchingAtlasColorPreset({ colorAccent: 'invalid' }), 'original');
  for (const preset of Object.values(ATLAS_COLOR_PRESETS)) {
    for (const key of Object.keys(ATLAS_COLOR_DEFAULTS)) {
      const settings = { ...preset.colors, [key]: '#112233' };
      assert.equal(matchingAtlasColorPreset(settings), 'custom');
    }
  }
});
