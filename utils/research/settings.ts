export interface ResearchSettings {
  autoCapture: boolean;
  socialAutoCapture: boolean;
  providers: { bofa: boolean; x: boolean; wechat: boolean; bilibili: boolean };
}

export const RESEARCH_SETTINGS_KEY = 'fin_report_clipper_settings';

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  autoCapture: true,
  socialAutoCapture: true,
  providers: { bofa: true, x: true, wechat: true, bilibili: true },
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
    socialAutoCapture: typeof raw.socialAutoCapture === 'boolean' ? raw.socialAutoCapture : true,
    providers: {
      bilibili: typeof providers.bilibili === 'boolean' ? providers.bilibili : true,
      wechat: typeof providers.wechat === 'boolean' ? providers.wechat : true,
      x: typeof providers.x === 'boolean' ? providers.x : true,
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

export function isXAutoCaptureEnabled(settings: ResearchSettings): boolean {
  return settings.socialAutoCapture && settings.providers.x;
}

export function isWechatAutoCaptureEnabled(settings: ResearchSettings): boolean {
  return settings.socialAutoCapture && settings.providers.wechat;
}

export function isBilibiliAutoCaptureEnabled(settings: ResearchSettings): boolean {
  return settings.socialAutoCapture && settings.providers.bilibili;
}
