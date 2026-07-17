export interface ResearchSettings {
  autoCapture: boolean;
  providers: { bofa: boolean };
}

export const RESEARCH_SETTINGS_KEY = 'fin_report_clipper_settings';

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  autoCapture: true,
  providers: { bofa: true },
};

export function normalizeResearchSettings(value: unknown): ResearchSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const providers =
    raw.providers && typeof raw.providers === 'object'
      ? (raw.providers as Record<string, unknown>)
      : {};
  return {
    autoCapture:
      typeof raw.autoCapture === 'boolean'
        ? raw.autoCapture
        : DEFAULT_RESEARCH_SETTINGS.autoCapture,
    providers: {
      bofa:
        typeof providers.bofa === 'boolean'
          ? providers.bofa
          : DEFAULT_RESEARCH_SETTINGS.providers.bofa,
    },
  };
}

export async function loadResearchSettings(): Promise<ResearchSettings> {
  const result = await chrome.storage.local.get(RESEARCH_SETTINGS_KEY);
  return normalizeResearchSettings(result[RESEARCH_SETTINGS_KEY]);
}

export async function saveResearchSettings(settings: ResearchSettings): Promise<void> {
  await chrome.storage.local.set({
    [RESEARCH_SETTINGS_KEY]: normalizeResearchSettings(settings),
  });
}

export function isBofaAutoCaptureEnabled(settings: ResearchSettings): boolean {
  return settings.autoCapture && settings.providers.bofa;
}
