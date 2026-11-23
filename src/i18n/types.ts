export type Language = 'ru' | 'az' | 'tr' | 'en';

export interface LanguageOption {
  code: Language;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'ru', name: 'Русский', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'az', name: 'Азербайджанский', nativeName: 'Azərbaycan', flag: '🇦🇿' },
  { code: 'tr', name: 'Турецкий', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'en', name: 'Английский', nativeName: 'English', flag: '🇬🇧' },
];
