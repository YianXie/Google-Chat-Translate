import { describe, expect, it } from 'vitest';
import { isLightColor } from '../src/shared/dom';

describe('isLightColor', () => {
  it.each([
    ['rgb(232, 234, 237)', true],
    ['rgba(255, 255, 255, 0.87)', true],
    ['rgb(31, 31, 31)', false],
    ['rgb(60, 64, 67)', false],
    ['', false],
    ['canvastext', false],
  ])('%s → %s', (color, light) => {
    expect(isLightColor(color)).toBe(light);
  });
});
