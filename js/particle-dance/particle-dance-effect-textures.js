/**
 * Adapted from Vizz.fm with the user’s confirmed permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-536ef188d65bad19.js
 * Retrieved 2026-10-08. No additional license is granted.
 */
// Source seeded Park–Miller generator. Texture generation never consumes scene RNG.
function createTextureRandom(seed) {
  let state = Math.max(1, Math.floor(seed));
  return () => ((state = 16807 * state % 2147483647) - 1) / 2147483646;
}

function createSurface(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas is required for texture effects.');
  return { canvas, context };
}

function createNoise(size, seed = 42) {
  const { canvas, context } = createSurface(size);
  const pixels = context.createImageData(size, size);
  const random = createTextureRandom(seed);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const value = (255 * random() + 255 * random()) / 2;
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = value;
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const smaller = createSurface(size / 2);
  smaller.context.drawImage(canvas, 0, 0, size / 2, size / 2);
  context.drawImage(smaller.canvas, 0, 0, size, size);
  return canvas;
}

const TEXTURE_GENERATORS = {
  noise: createNoise,
  paper(size) {
    const { canvas, context } = createSurface(size);
    const random = createTextureRandom(123);
    context.fillStyle = '#c8c8c8';
    context.fillRect(0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const noise = Math.floor(30 * random() - 15);
      for (let channel = 0; channel < 3; channel++) {
        pixels.data[offset + channel] = Math.max(0, Math.min(255, pixels.data[offset + channel] + noise));
      }
    }
    context.putImageData(pixels, 0, 0);
    context.globalAlpha = 0.04;
    context.strokeStyle = '#666';
    context.lineWidth = 0.5;
    for (let index = 0; index < 200; index++) {
      const y = random() * size, x = random() * size, length = 40 * random() + 10;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + length, y + (random() - 0.5) * 4);
      context.stroke();
    }
    context.globalAlpha = 1;
    return canvas;
  },
  grid(size) {
    const { canvas, context } = createSurface(size);
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = '#606060';
    context.lineWidth = 1;
    const spacing = size / 16;
    for (let x = 0; x <= size; x += spacing) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, size); context.stroke();
    }
    for (let y = 0; y <= size; y += spacing) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(size, y); context.stroke();
    }
    return canvas;
  },
  dots(size) {
    const { canvas, context } = createSurface(size);
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
    const spacing = size / 16, radius = 0.15 * spacing;
    context.fillStyle = '#505050';
    for (let x = spacing / 2; x < size; x += spacing) {
      for (let y = spacing / 2; y < size; y += spacing) {
        context.beginPath(); context.arc(x, y, radius, 0, 2 * Math.PI); context.fill();
      }
    }
    return canvas;
  },
  diagonal(size) {
    const { canvas, context } = createSurface(size);
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = '#606060';
    context.lineWidth = 1.5;
    for (let x = -size; x < 2 * size; x += size / 12) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x + size, size); context.stroke();
    }
    return canvas;
  },
  hexgrid(size) {
    const { canvas, context } = createSurface(size);
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
    const radius = size / 12, height = Math.sqrt(3) * radius;
    const rows = Math.ceil(size / height) + 1;
    function hexagon(x, y) {
      context.beginPath();
      for (let index = 0; index < 6; index++) {
        const angle = Math.PI / 3 * index;
        const px = x + radius * Math.cos(angle), py = y + radius * Math.sin(angle);
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath(); context.stroke();
    }
    context.strokeStyle = '#505050';
    context.lineWidth = size / 90;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    for (let row = -1; row <= rows; row++) {
      for (let column = -1; column <= 4; column++) {
        const x = 3 * column * radius + 1.5 * radius, y = row * height;
        hexagon(x, y); hexagon(x + 1.5 * radius, y + height / 2);
      }
    }
    return canvas;
  },
};

export function createTextureCanvas(preset, size = 512, seed = 42) {
  if (preset === 'noise' || preset === 'noiseAnimated') return createNoise(size, seed);
  return TEXTURE_GENERATORS[preset]?.(size) ?? null;
}
