"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserDefaultLocale, localeStorageKey, messages, normalizeLocale, type Locale } from "@/lib/i18n";

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = normalizeLocale(window.localStorage.getItem(localeStorageKey));
    setLocaleState(stored ?? browserDefaultLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    window.localStorage.setItem(localeStorageKey, nextLocale);
    setLocaleState(nextLocale);
    window.dispatchEvent(new CustomEvent("invisible-maze:locale", { detail: nextLocale }));
  }, []);

  useEffect(() => {
    function onLocaleChange(event: Event) {
      const nextLocale = normalizeLocale((event as CustomEvent).detail);
      if (nextLocale) setLocaleState(nextLocale);
    }

    window.addEventListener("invisible-maze:locale", onLocaleChange);
    return () => window.removeEventListener("invisible-maze:locale", onLocaleChange);
  }, []);

  return useMemo(
    () => ({
      locale,
      setLocale,
      t: messages[locale]
    }),
    [locale, setLocale]
  );
}
