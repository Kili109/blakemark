export type ThemeChoice = "dark" | "light";
export type LinkChoice = "browser" | "app" | "here";

export type Settings = {
  theme: ThemeChoice;
  links: LinkChoice;
};

const KEY = "blakemark-settings";

export const DEFAULT_SETTINGS: Settings = { theme: "dark", links: "browser" };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: parsed.theme === "light" ? "light" : "dark",
      links: parsed.links === "app" || parsed.links === "here" ? parsed.links : "browser",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type NativeChrome = {
  setChrome?: (theme: string, links: string) => void;
};

export function applySettings(settings: Settings) {
  document.documentElement.dataset.theme = settings.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", settings.theme === "light" ? "#f4efe6" : "#14120e");
  const native = (window as unknown as { BlakemarkNative?: NativeChrome }).BlakemarkNative;
  native?.setChrome?.(settings.theme, settings.links);
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
  applySettings(settings);
}
