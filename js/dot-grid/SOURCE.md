# Dot Grid source

Adapted from [Vizz.fm by Mathew Preziotte](https://vizz.fm/app/?preset=Y29uZmlnLTE3NjYyODMxMjcwNDEtNDcy), with permission supplied by the user for this personal project. Copyright (c) 2026 Mathew Preziotte. All rights reserved. No additional license is granted.

- Retrieved: 25 October 2026.
- Public application bundle: https://vizz.fm/_next/static/chunks/9583-5bcee8001b3090e9.js
- Bundle SHA-256: `049859defa821b49da55dd5e2aa55a68489e73c1bd528081dd1507ba80971cc9`.
- Application release: `01c6052`.
- Default preset: `config-1766283127041-472` (variant 1).

`dot-grid-scene.js` adapts the original Dot Grid hook's instanced sphere geometry, lighting, frequency mapping, wave/spiral/sphere deformation, smoothing and colour response into the repository's scene interface. `dot-grid-settings.js` retains all 18 original visualiser controls; `dot-grid-presets.js` retains the seven source records in the original variant order and preserves their source names. Sparse presets inherit the source defaults, including the postprocessing master switch.

Playback and capture use this repository's existing modules: decoded-audio analysis from Mesh Grid, background and camera support from the other Vizz ports, Particle Dance postprocessing and slider modulation, and the recorder/export pipeline also used by Pulse Atlas. Preview and offline export step the same analysis and scene at 60 Hz. Seeking restarts temporal history at the chosen position, as in the other Vizz ports.

The page is served as a standalone entry point (`dot-grid.html`) with local companion modules. Three.js and MP4 Muxer load from the same pinned CDN versions used elsewhere in this project. No Vizz server or account is needed at runtime.

The adaptation intentionally honors zero-valued controls (the original hook uses truthy fallbacks), bounds structural dimensions to their published integer range, and disables stale aggregate frustum bounds while the grid deforms. Paused control edits update geometry immediately without advancing wave history; a plain repaint preserves the instance buffers exactly. A differential check against the extracted original hook compared 1,080 frames across nine routing/deformation scenarios, matching instance matrices and HSL color arguments within `2e-6`; Three.js color conversion and GPU rendering are covered separately by the browser harness.


## Scrolling Spectrum Mode

The **Scrolling Spectrum Mode** checkbox applies LED Grid's Spectral Loom analysis to the current dot grid. The existing seven Vizz variants remain available. The local extension reuses `js/led-grid/led-analysis.js` and its worker, 96 logarithmic frequency bands and six-second light-domain history. The mapper resamples the four original palette contributions onto the chosen dot dimensions, retaining narrow frequency peaks. The scrolling-spectrum controls set horizontal orientation, gain, persistence, light level and palette colors; dot size, spacing, grid dimensions, audio size response, height and sphere deformation remain editable.

History uses absolute audio time, so seeking reconstructs the preceding passage rather than starting an empty trail. The same history feeds live playback, recording and offline export. Spectrum preparation happens in the existing analysis worker; cached passages are reused across control changes. The Vizz analyser controls continue to drive effect modulation, while spectrum gain controls the calibrated Loom history.
