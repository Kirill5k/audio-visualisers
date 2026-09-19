import { createSpectralPlayer } from './spectral-player.js';
import { createSpectralTerrainScene } from './spectral-terrain-scene.js';

const settings = {
  gain: 1.3,
  height: 1.7,
  lineWidth: 1,
  ridgeSpacing: 1,
  frequencySpread: 1.5,
  historySeconds: 6,
  terrainNear: '#6B9FFF',
  terrainFar: '#203A73',
  energyHue: false,
};

window.spectralTerrain = await createSpectralPlayer({
  name: 'Spectral Terrain', slug: 'spectral-terrain', settings,
  createScene: createSpectralTerrainScene,
  historySeconds: 12, historyPaddingFrames: 2,
  previewAspect: 16 / 9, previewMinWidth: 3840, previewMinHeight: 2160,
  quality: scene => ({ terrainColumns: 16384, terrainRidges: scene.getInfo().ridges, historyRows: 722 }),
  controls: ['gain', 'height', 'lineWidth', 'ridgeSpacing', 'frequencySpread', 'historySeconds', 'terrainNear', 'terrainFar', 'energyHue'],
  extend(player) {
    const { scene, bind } = player;
    const buttons = [...document.querySelectorAll('[data-view]')];
    function syncCameraButtons() {
      const preset = scene.getCameraState().preset;
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.view === preset));
    }
    function setView(view) {
      if (player.locked) return false;
      scene.setView(view);
      syncCameraButtons();
      player.invalidate();
      return scene.getCameraState();
    }
    for (const button of buttons) {
      button.addEventListener('click', () => setView(button.dataset.view));
    }
    bind('resetCameraBtn', 'click', () => setView('oblique'));
    return {
      initialize: syncCameraButtons,
      onRender() {
        syncCameraButtons();
        document.getElementById('ridgeCount').textContent = String(scene.getInfo().ridges);
      },
      getState: () => ({ camera: scene.getCameraState() }),
      api: {
        setView,
        resetCamera: () => setView('oblique'),
        getCameraState: () => scene.getCameraState(),
        setCameraState(state) {
          if (player.locked) return false;
          scene.setCameraState(state);
          syncCameraButtons();
          player.invalidate();
          return scene.getCameraState();
        },
      },
    };
  },
});
