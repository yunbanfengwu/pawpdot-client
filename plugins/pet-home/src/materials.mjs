import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

// Deterministic hand-authored texture patterns keep the scene self-contained and reproducible.
export function woodTexture() {
  const image = document.createElement('canvas'); image.width = 256; image.height = 1024;
  const context = image.getContext('2d');
  context.fillStyle = '#c7ab84'; context.fillRect(0, 0, image.width, image.height);
  for (let line = 0; line < 600; line++) {
    const x = (line * 127.371) % 256;
    context.strokeStyle = `rgba(${line % 2 ? '87,57,28' : '255,240,199'},${.015 + (line % 9) * .004})`;
    context.lineWidth = line % 7 === 0 ? 1.6 : .5;
    context.beginPath();
    for (let y = 0; y <= 1024; y += 24) {
      const bend = Math.sin(y * .006 + line * .42) * (1.5 + line % 6);
      if (!y) context.moveTo(x + bend, y); else context.lineTo(x + bend, y);
    }
    context.stroke();
  }
  const texture = new CanvasTexture(image); texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(1, 2); texture.anisotropy = 4;
  return texture;
}

export function weaveTexture() {
  const image = document.createElement('canvas'); image.width = image.height = 128;
  const context = image.getContext('2d'); context.fillStyle = '#ece6db'; context.fillRect(0, 0, 128, 128);
  for (let index = 0; index < 128; index += 4) {
    context.fillStyle = '#d7d0c3'; context.fillRect(index, 0, 1, 128);
    context.fillStyle = '#f5f0e7'; context.fillRect(0, index, 128, 1);
  }
  const texture = new CanvasTexture(image); texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(10, 10); texture.anisotropy = 4;
  return texture;
}
