import React, { createContext, useContext } from 'react'
import { useRouter } from 'next/router'
import I18nContext from './_context'
import useTranslation from './useTranslation'
import {
  I18n,
  I18nConfig,
  I18nProviderProps,
  LoggerProps,
  TranslationQuery,
} from '.'

const NsContext = createContext({})

/**
 * Get value from key (allow nested keys as parent.children)
 */
function getDicValue(
  dic: Object,
  key: string = '',
  options: { returnObjects?: boolean; fallback?: string | string[] } = {
    returnObjects: false,
  }
): string | undefined | unknown {
  const value: string | unknown = key
    .split('.')
    .reduce(
      (val: Object, key: string) => val[key as keyof typeof val] || {},
      dic
    )

  if (
    typeof value === 'string' ||
    ((value as unknown) instanceof Object && options.returnObjects)
  ) {
    return value
  }
}

/**
 * Control plural keys depending the {{count}} variable
 */
function plural(
  pluralRules,
  dic: Object,
  key: string,
  query?: TranslationQuery | null
): string {
  if (!query || typeof query.count !== 'number') return key

  const numKey = `${key}_${query.count}`
  if (getDicValue(dic, numKey) !== undefined) return numKey

  const pluralKey = `${key}_${pluralRules.select(query.count)}`
  if (query.count > 1 && getDicValue(dic, pluralKey) !== undefined) {
    return pluralKey
  }

  return key
}

/**
 * Replace {{variables}} to query values
 */
function interpolation({
  text,
  query,
  config,
}: {
  text?: string
  query?: TranslationQuery | null
  config: I18nConfig
}): string {
  if (!text || !query) return text || ''

  const escapeRegex = (str: string) =>
    str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const {
    interpolation: { prefix, suffix } = { prefix: '{{', suffix: '}}' },
  } = config

  return Object.keys(query).reduce((all, varKey) => {
    const regex = new RegExp(
      `${escapeRegex(prefix)}\\s*${varKey}\\s*${escapeRegex(suffix)}`,
      'gm'
    )
    all = all.replace(regex, `${query[varKey]}`)
    return all
  }, text)
}

function objectInterpolation({
  obj,
  query,
  config,
}: {
  obj: Record<string, string | unknown>
  query?: TranslationQuery | null
  config: I18nConfig
}): Object {
  if (!query || Object.keys(query).length === 0) return obj

  Object.keys(obj).forEach((key) => {
    if (obj[key] instanceof Object)
      objectInterpolation({
        obj: obj[key] as Record<string, string | unknown>,
        query,
        config,
      })
    if (typeof obj[key] === 'string')
      obj[key] = interpolation({ text: obj[key] as string, query, config })
  })

  return obj
}

function missingKeyLogger({ namespace, i18nKey }: LoggerProps): void {
  if (process.env.NODE_ENV === 'production') return

  // This means that instead of "ns:value", "value" has been misspelled (without namespace)
  if (!i18nKey) {
    console.warn(
      `[next-translate] The text "${namespace}" has no namespace in front of it.`
    )
    return
  }
  console.warn(
    `[next-translate] "${namespace}:${i18nKey}" is missing in current namespace configuration. Try adding "${i18nKey}" to the namespace "${namespace}".`
  )
}

export default function I18nProvider({
  lang: lng,
  namespaces = {},
  children,
  config: newConfig = {},
}: I18nProviderProps) {
  const { lang: parentLang, config: parentConfig = {} } = useTranslation()
  const { locale, defaultLocale } = useRouter() || {}
  const lang = lng || parentLang || locale || defaultLocale || ''
  const ns = useContext(NsContext)
  const allNamespaces = { ...ns, ...namespaces } as Record<string, Object>
  const pluralRules = new Intl.PluralRules(lang)
  const config = { ...parentConfig, ...newConfig }
  const { logger = missingKeyLogger } = config

  function t(
    key: string = '',
    query: TranslationQuery | null | undefined,
    options?: { returnObjects?: boolean; fallback?: string | string[] }
  ) {
    const k = Array.isArray(key) ? key[0] : key
    const [namespace, i18nKey] = k.split(/:(.+)/)
    const dic = allNamespaces[namespace] || {}
    const keyWithPlural = plural(pluralRules, dic, i18nKey, query)
    const value = getDicValue(dic, keyWithPlural, options)

    const empty =
      typeof value === 'undefined' ||
      (typeof value === 'object' && !Object.keys(value).length)

    const fallbacks =
      typeof options?.fallback === 'string'
        ? [options.fallback]
        : options?.fallback || []

    // Log only during CSR
    if (typeof window !== 'undefined' && empty) {
      logger({ namespace, i18nKey })
    }

    // Fallbacks
    if (empty && Array.isArray(fallbacks) && fallbacks.length) {
      const [firstFallback, ...restFallbacks] = fallbacks
      if (typeof firstFallback === 'string') {
        return t(firstFallback, query, { ...options, fallback: restFallbacks })
      }
    }

    if (value instanceof Object) {
      return objectInterpolation({
        obj: value as Record<string, unknown>,
        query,
        config,
      })
    }

    return interpolation({ text: value as string, query, config }) || k
  }

  return (
    <I18nContext.Provider value={{ lang, t, config } as I18n}>
      <NsContext.Provider value={allNamespaces}>{children}</NsContext.Provider>
    </I18nContext.Provider>
  )
}
