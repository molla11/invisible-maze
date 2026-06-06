"use client";

import { Languages } from "lucide-react";
import { localeLabels, type Locale } from "@/lib/i18n";

type Props = {
  locale: Locale;
  label: string;
  currentLabel: string;
  onChange(locale: Locale): void;
};

export function LanguageSwitch({ locale, label, currentLabel, onChange }: Props) {
  const nextLocale: Locale = locale === "ko" ? "en" : "ko";

  return (
    <button
      aria-label={`${label}: ${localeLabels[nextLocale]}`}
      className="language-switch"
      onClick={() => onChange(nextLocale)}
      title={`${label}: ${localeLabels[nextLocale]}`}
      type="button"
    >
      <Languages size={16} aria-hidden="true" />
      <span className="language-current">{currentLabel}</span>
      <span className={locale === "ko" ? "is-active" : ""}>{localeLabels.ko}</span>
      <span aria-hidden="true">/</span>
      <span className={locale === "en" ? "is-active" : ""}>{localeLabels.en}</span>
    </button>
  );
}
