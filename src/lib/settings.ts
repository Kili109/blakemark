import { isCurrency, type Currency } from "./market/money";

export type ThemeChoice = "dark" | "light";
export type LinkChoice = "browser" | "app" | "here";

export type Settings = {
  theme: ThemeChoice;
  links: LinkChoice;
  axes: boolean;
  currency: Currency;
  contrastDark: number;
  contrastLight: number;
  contrastLightScale: number;
  defaultsRev: number;
};

const KEY = "blakemark-settings";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  links: "here",
  axes: true,
  currency: "USD",
  contrastDark: 50,
  contrastLight: 50,
  contrastLightScale: 2,
  defaultsRev: 3,
};

const DARK = {
  bg: ["#171522", "#07060c"],
  surface: ["#221f30", "#100e18"],
  raised: ["#2e2a40", "#1a1628"],
  fg: ["#f6f1fb", "#ffffff"],
  muted: ["#b7adc9", "#ece6f6"],
  line: ["#3c3652", "#625a7c"],
} as const;

const LIGHT = {
  bg: ["#f3eefb", "#fbfafe"],
  surface: ["#fffbff", "#fffeff"],
  raised: ["#e7e0f3", "#f6f3fb"],
  fg: ["#5a547a", "#151320"],
  muted: ["#8d86a8", "#3e3b50"],
  line: ["#ddd6ec", "#c4bad6"],
} as const;

function clampContrast(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function mix(from: string, to: string, amount: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) => {
    const start = (a >> shift) & 255;
    const end = (b >> shift) & 255;
    return Math.round(start + (end - start) * amount);
  };
  const r = channel(16);
  const g = channel(8);
  const bl = channel(0);
  return "#" + [r, g, bl].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function migratedLight(value: unknown): number {
  const p = clampContrast(value);
  if (p >= 50) return 100;
  return Math.round(68 + p * 0.64);
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (parsed.defaultsRev !== 3) {
      localStorage.setItem(KEY, JSON.stringify(DEFAULT_SETTINGS));
      return DEFAULT_SETTINGS;
    }
    const needsLight = parsed.contrastLightScale !== 2;
    const settings: Settings = {
      theme: parsed.theme === "light" ? "light" : "dark",
      links: parsed.links === "app" || parsed.links === "here" ? parsed.links : "browser",
      axes: parsed.axes === true,
      currency: isCurrency(parsed.currency) ? parsed.currency : "USD",
      contrastDark: clampContrast(parsed.contrastDark),
      contrastLight: needsLight ? migratedLight(parsed.contrastLight) : clampContrast(parsed.contrastLight),
      contrastLightScale: 2,
      defaultsRev: 3,
    };
    if (needsLight) localStorage.setItem(KEY, JSON.stringify(settings));
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type NativeChrome = {
  setChrome?: (theme: string, links: string) => void;
};

export function applySettings(settings: Settings) {
  const light = settings.theme === "light";
  const amount = (light ? settings.contrastLight : settings.contrastDark) / 100;
  const scale = light ? LIGHT : DARK;
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  const bg = mix(scale.bg[0], scale.bg[1], amount);
  root.style.setProperty("--color-bg", bg);
  root.style.setProperty("--color-surface", mix(scale.surface[0], scale.surface[1], amount));
  root.style.setProperty("--color-raised", mix(scale.raised[0], scale.raised[1], amount));
  root.style.setProperty("--color-fg", mix(scale.fg[0], scale.fg[1], amount));
  root.style.setProperty("--color-muted", mix(scale.muted[0], scale.muted[1], amount));
  root.style.setProperty("--color-line", mix(scale.line[0], scale.line[1], amount));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", bg);
  const native = (window as unknown as { BlakemarkNative?: NativeChrome }).BlakemarkNative;
  native?.setChrome?.(settings.theme, settings.links);
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
  applySettings(settings);
}
