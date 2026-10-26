import { createContext, useContext, useEffect, useState } from 'react';
import { initialLanguage, LANGUAGE_KEY, translate, translateCheck } from './i18n.mjs';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    let storage;
    try { storage = window.localStorage; } catch { /* Private storage may be unavailable. */ }
    return initialLanguage(storage, navigator.language);
  });
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    try { window.localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Switching still works without persistence. */ }
  }, [language]);
  return <LanguageContext.Provider value={{ language, setLanguage, t: value => translate(value, language), checkText: check => translateCheck(check, language) }}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return <div className="language-switcher" role="group" aria-label={language === 'zh' ? '界面语言' : 'Interface language'}>
    <button type="button" lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
    <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
  </div>;
}
