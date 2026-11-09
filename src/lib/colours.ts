// Lighter, darker and mixed colours, computed in OKLab so equal steps look
// equal (the same helpers as the portal's chartColors.js).

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearRgb([L, a, b]: number[]): number[] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const toHex = (rgb: number[]) =>
  `#${rgb.map((c) => Math.round(toGamma(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, "0")).join("")}`;

/** The colour at OKLab lightness `L` with the hue of `hex`, losing chroma until it fits sRGB. */
function atLightness(hex: string, L: number): string {
  const [, a, b] = oklab(hex);
  for (let k = 1; k > 0; k -= 0.05) {
    const rgb = linearRgb([L, a * k, b * k]);
    if (rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4)) return toHex(rgb);
  }
  return hex;
}

/** OKLab lightness of a colour, 0 (black) to 1 (white). */
export function lightness(hex: string): number {
  return oklab(hex)[0];
}

/** `n` distinguishable members of one colour family: the colour itself first,
 * then alternately darker and lighter steps. */
export function shades(hex: string, n: number): string[] {
  const L = oklab(hex)[0];
  const step = Math.min(0.12, 0.3 / Math.max(1, Math.ceil((n - 1) / 2)));
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return hex;
    const k = Math.ceil(i / 2) * (i % 2 ? -1 : 1);
    return atLightness(hex, Math.min(0.9, Math.max(0.3, L + k * step)));
  });
}

/** `n` steps of one hue from light to dark, for an ordered annotation. */
export function ramp(n: number, hex: string): string[] {
  if (n === 1) return [hex];
  return Array.from({ length: n }, (_, i) => atLightness(hex, 0.84 - (0.46 * i) / (n - 1)));
}

/** The colour a fraction `t` (0–1) of the way from `a` to `b`, in OKLab. */
export function mix(a: string, b: string, t: number): string {
  const A = oklab(a);
  const B = oklab(b);
  return toHex(linearRgb(A.map((v, i) => v + (B[i] - v) * t)));
}

/** Sequential blue, light to dark (the dataviz ramp, steps 100 to 700). */
export const SEQUENTIAL_BLUE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
/** The poles of a diverging scale (negative red, positive blue) and its grey midpoint. */
export const DIVERGING = { negative: "#e34948", positive: "#2a78d6", mid: "#dfe3e8", midDark: "#3a4655" };
