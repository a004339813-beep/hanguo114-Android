import AuthGate from '@/components/auth/auth-gate'
import BottomNav from '@/components/shared/bottom-nav'
import { DictionaryProvider } from '@repo/shared'
import { routing } from '@/i18n/routing'
import { getBrandSubtitle } from '@/lib/brand'
import { siteConfig } from '@/config/site.config'
import { APP_VERSION } from '@/lib/version'
import JsonLd from '@/components/seo/json-ld'
import {
  HOME_TITLE_BY_LOCALE,
  HOME_DESCRIPTION_BY_LOCALE,
  JOB_SEO_KEYWORDS_BY_LOCALE,
  getSiteUrl,
  getLocalizedUrl,
  isSeoLocale,
  buildAlternatesMetadata,
  buildSeoRobotsMetadata,
  buildSocialMetadata,
} from '@/lib/seo'
import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getScopedMessages } from '@/i18n/messages'
import { notFound } from 'next/navigation'
import '../globals.css'
import Providers from '../providers'
import { HydrationBoundary, dehydrate, QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@repo/shared'
import { getCachedDictionaries, getCachedOrganization } from '@/lib/data-cache'
import MaintenanceGate from '@/components/shared/maintenance-gate'
import TabShellContainer from '@/components/layout/tab-shell-container'
import { OverlayHosts } from '@/components/layout/overlay-hosts'
import { JobDetailOverlayHost } from '@/components/jobs/job-detail-overlay'
import { RouterTransition } from '@/components/layout/router-transition'
import RootLayoutErrorBoundary from '@/components/layout/root-layout-error-boundary'
import { AppleSplashLinks } from '@/components/shared/apple-splash-links'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale })
  const appName = siteConfig.id === 'korean114' ? siteConfig.name : t('appName')
  const subtitle = getBrandSubtitle(locale)
  const description = HOME_DESCRIPTION_BY_LOCALE[locale] || subtitle

  const defaultTitle = HOME_TITLE_BY_LOCALE[locale] || appName
  const seoIndexable = isSeoLocale(locale)

  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: defaultTitle,
      template: `%s | ${appName}`,
    },
    description,
    applicationName: appName,
    category: 'jobs',
    keywords: [
      appName,
      subtitle,
      ...(JOB_SEO_KEYWORDS_BY_LOCALE[locale] || JOB_SEO_KEYWORDS_BY_LOCALE[siteConfig.features.defaultLocale] || siteConfig.seo.brandKeywords),
    ],
    ...buildSocialMetadata({
      title: defaultTitle,
      description,
      url: getLocalizedUrl(locale, '/'),
      locale,
      siteName: appName,
      image: siteConfig.branding.ogCover,
    }),
    alternates: buildAlternatesMetadata(locale, '/'),
    manifest: `/${locale}/manifest.webmanifest?v=${APP_VERSION}`,
    appleWebApp: {
      capable: true,
      title: appName,
      statusBarStyle: 'default',
    },
    formatDetection: {
      address: false,
      email: false,
      telephone: false,
    },
    icons: {
      icon: [
        { url: `${siteConfig.branding.favicon}?v=${APP_VERSION}`, type: 'image/x-icon' },
        { url: `${siteConfig.branding.icon}?v=${APP_VERSION}`, sizes: '192x192', type: 'image/png' },
        { url: `${siteConfig.branding.appleTouchIcon}?v=${APP_VERSION}`, sizes: '180x180', type: 'image/png' },
      ],
      apple: [
        { url: `${siteConfig.branding.appleTouchIcon}?v=${APP_VERSION}`, sizes: '180x180', type: 'image/png' },
      ],
      shortcut: [`${siteConfig.branding.favicon}?v=${APP_VERSION}`],
    },
    robots: buildSeoRobotsMetadata(seoIndexable),
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F5F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0F1E' },
  ],
}

// The shell + the global SSR data it hydrates (dictionaries and org branding) do not
// depend on the request (no cookies/headers), so they are safely cacheable. Job data is
// intentionally fetched by the active home query instead of every locale route: the
// root layout also wraps login, profile, search and detail pages.
// ISR keeps TTFB low (most requests are served from cache) and revalidates every 1 hour,
// matching the revalidate window already declared on the home page.
export const revalidate = 3600

// Only statically pre-enumerate compliant SEO locales (strictly excluding 'ko');
// non-SEO locales remain accessible on demand via dynamicParams.
export function generateStaticParams() {
  const seoLocales = siteConfig.features.seoLocales || [siteConfig.features.defaultLocale]
  return seoLocales.map((locale) => ({ locale }))
}

import { Suspense } from 'react'

import { OfflineGate } from '@/components/shared/offline-gate'
import { PageTracker } from '@/components/shared/page-tracker'
import { UmamiAnalytics } from '@/components/shared/umami-analytics'

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const normalizedLocale = locale as (typeof routing.locales)[number]

  if (!routing.locales.includes(normalizedLocale)) {
    notFound()
  }

  // Enables static rendering / ISR for next-intl (otherwise getMessages/getTranslations
  // fall back to a dynamic request-locale read and force every route to be server-rendered).
  setRequestLocale(normalizedLocale)

  const messages = getScopedMessages(normalizedLocale)

  // Only shared shell data belongs here. HomePage injects its own initial jobs,
  // so detail routes neither wait for nor depend on the home list cache.
  const queryClient = new QueryClient()
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.dictionaries('all'),
      queryFn: () => getCachedDictionaries(),
    }),
    queryClient.prefetchQuery({
      queryKey: ['admin', 'organization', 1],
      queryFn: () => getCachedOrganization(1),
    }),
  ])
  const dehydratedState = dehydrate(queryClient)

  return (
    <html lang={locale} className="bg-background" style={{ backgroundColor: 'var(--background)' }} suppressHydrationWarning>
      <head>
        {/* 认证会话、总数查询与边缘接口降级仍直连 Supabase，提前完成 DNS+TCP+TLS */}
        <link rel="preconnect" href="https://ocfohbkrcdgtrnljrhfj.supabase.co" crossOrigin="anonymous" />
        <link rel="apple-touch-icon" href={`${siteConfig.branding.appleTouchIcon}?v=${APP_VERSION}`} />
        <link rel="apple-touch-icon-precomposed" href={`${siteConfig.branding.appleTouchIcon}?v=${APP_VERSION}`} />
        <meta name="mobile-web-app-capable" content="yes" />
        {isSeoLocale(locale) ? (
          <JsonLd
            data={[
              {
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                '@id': `${getSiteUrl()}/#website`,
                name: siteConfig.id === 'korean114'
                  ? 'Korean114 - Jobs in Korea'
                  : '韩国114 - 韩国找工作',
                alternateName: siteConfig.seo.brandKeywords,
                url: getSiteUrl(),
                description: HOME_DESCRIPTION_BY_LOCALE[locale] || siteConfig.name,
                inLanguage: locale,
                publisher: {
                  '@id': `${getSiteUrl()}/#organization`,
                },
                potentialAction: {
                  '@type': 'SearchAction',
                  target: {
                    '@type': 'EntryPoint',
                    urlTemplate: `${getSiteUrl()}/${locale}/search?q={search_term_string}`,
                  },
                  'query-input': 'required name=search_term_string',
                },
              },
              {
                '@context': 'https://schema.org',
                '@type': 'EmploymentAgency',
                '@id': `${getSiteUrl()}/#organization`,
                name: siteConfig.name,
                url: getSiteUrl(),
                logo: {
                  '@type': 'ImageObject',
                  url: `${getSiteUrl()}${siteConfig.branding.icon}`,
                  width: 192,
                  height: 192,
                },
                description: HOME_DESCRIPTION_BY_LOCALE[locale] || siteConfig.name,
                areaServed: {
                  '@type': 'Country',
                  name: 'South Korea',
                },
              },
            ]}
          />
        ) : null}
        <AppleSplashLinks />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // PWA 安装事件捕获：必须早于 React hydration，否则 beforeinstallprompt 可能在挂载前触发而丢失，
                // 导致 Android 用户掉进手动教程而非原生一步安装弹窗。OnboardingOverlay 挂载后读取 window.__jiBip。
                window.addEventListener('beforeinstallprompt', function (e) {
                  try { e.preventDefault(); window.__jiBip = e; } catch (err) {}
                });

                // 外观主题 0ms 同步挂载：优先读取用户手动偏好（light/dark），否则跟随系统外观，杜绝首屏闪屏
                var darkMql = null;
                var THEME_KEY = 'job_infinity_theme_preference';
                var readStoredTheme = function () {
                  try {
                    var v = window.localStorage.getItem(THEME_KEY);
                    return (v === 'light' || v === 'dark') ? v : 'system';
                  } catch (err) {
                    return 'system';
                  }
                };
                var applyColorScheme = function (pref, systemIsDark) {
                  try {
                    var isDark = pref === 'dark' ? true : (pref === 'light' ? false : Boolean(systemIsDark));
                    var root = document.documentElement;
                    if (!root) return;
                    if (isDark) {
                      root.classList.add('dark');
                      root.classList.remove('light');
                      root.style.colorScheme = 'dark';
                    } else {
                      root.classList.remove('dark');
                      root.classList.add('light');
                      root.style.colorScheme = 'light';
                    }
                    if (pref === 'light' || pref === 'dark') {
                      var color = isDark ? '#0A0F1E' : '#F3F5F9';
                      var metas = document.querySelectorAll('meta[name="theme-color"]');
                      for (var i = 0; i < metas.length; i++) {
                        metas[i].setAttribute('content', color);
                      }
                    }
                  } catch (err) {}
                };
                try {
                  darkMql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
                  applyColorScheme(readStoredTheme(), darkMql ? darkMql.matches : false);
                  if (darkMql) {
                    var onSchemeChange = function (e) {
                      if (readStoredTheme() === 'system') {
                        applyColorScheme('system', e.matches);
                      }
                    };
                    if (typeof darkMql.addEventListener === 'function') {
                      darkMql.addEventListener('change', onSchemeChange);
                    } else if (typeof darkMql.addListener === 'function') {
                      darkMql.addListener(onSchemeChange);
                    }
                  }
                } catch (err) {}

                // Standalone 独立应用模式自适应标记：0ms 同步挂载到 <html> class，杜绝视觉闪烁
                try {
                  var isStandalone = Boolean(
                    (window.matchMedia && (
                      window.matchMedia('(display-mode: standalone)').matches ||
                      window.matchMedia('(display-mode: fullscreen)').matches ||
                      window.matchMedia('(display-mode: minimal-ui)').matches
                    )) ||
                    window.navigator.standalone ||
                    document.referrer.indexOf('android-app://') !== -1 ||
                    navigator.userAgent.indexOf('JobInfinityApp/') !== -1
                  );
                  if (isStandalone) {
                    document.documentElement.classList.add('standalone-mode');
                  }
                } catch (err) {}

                if ('scrollRestoration' in history) {
                  history.scrollRestoration = 'manual';
                }
                var isReload = false;
                var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
                if (nav && nav.type === 'reload') {
                  isReload = true;
                } else if (performance.navigation && performance.navigation.type === 1) {
                  isReload = true;
                }
                var isBack = false;
                try {
                  isBack = sessionStorage.getItem('navigated_to_detail') === '1';
                } catch (e) {}

                if (isReload || !isBack) {
                  try {
                    for (var i = sessionStorage.length - 1; i >= 0; i--) {
                      var k = sessionStorage.key(i);
                      if (k && (k.indexOf('scroll') === 0 || k === 'last_scroll_y' || k === 'job-navigation-context' || k === 'last_viewed_job_id')) {
                        sessionStorage.removeItem(k);
                      }
                    }
                    sessionStorage.removeItem('navigated_to_detail');
                    sessionStorage.removeItem('detail_nav_from_path');
                  } catch (e) {}
                  window.scrollTo(0, 0);
                  if (document.documentElement) document.documentElement.scrollTop = 0;
                  if (document.body) document.body.scrollTop = 0;
                }

                // iOS Safari / 移动端后台恢复、动态 Chunk 失效及 Next.js 顶层未捕获异常自愈机制
                var recoveryInProgress = false;
                function hasNextErrorUi() {
                  if (document.documentElement.id === '__next_error__' || document.getElementById('__next_error__')) {
                    return true;
                  }
                  if (document.getElementById('main-content')) {
                    return false;
                  }
                  return Boolean(document.body && /Application error: a client-side exception has occurred/i.test(document.body.innerText || ''));
                }
                function autoRecoverChunkError(reason) {
                  if (recoveryInProgress) return;
                  // 严禁对搜索引擎爬虫触发 ?_v= 强制跳转，避免 Bing/Google 抓取大量重复参数 URL
                  if (/bot|crawl|spider|slurp|bingpreview|googlebot|bingbot|yandex|baiduspider|duckduckbot/i.test(navigator.userAgent || '')) {
                    return;
                  }
                  recoveryInProgress = true;
                  try {
                    var k = '${siteConfig.id}_chunk_reload_ts';
                    var last = Number(sessionStorage.getItem(k) || 0);
                    var now = Date.now();
                    // 10 秒防抖，避免极端网络下的连续刷新
                    if (now - last <= 10000) {
                      recoveryInProgress = false;
                      return;
                    }
                    sessionStorage.setItem(k, String(now));
                    var cleanupTasks = [];

                    // 1. 彻底清除 Cache Storage 中所有的旧版本 chunk，并等待完成
                    if ('caches' in window) {
                      cleanupTasks.push(
                        caches.keys().then(function(keys) {
                          return Promise.all(keys.map(function(name) { return caches.delete(name); }));
                        }).catch(function() {})
                      );
                    }

                    // 2. 取消旧 ServiceWorker 注册，并等待注销完成
                    if ('serviceWorker' in navigator) {
                      cleanupTasks.push(
                        navigator.serviceWorker.getRegistrations().then(function(regs) {
                          return Promise.all(regs.map(function(reg) { return reg.unregister(); }));
                        }).catch(function() {})
                      );
                    }

                    // 3. 等待缓存清理，最多等待 1.5 秒后再强制刷新，避免 Safari 竞态
                    var cleanup = Promise.all(cleanupTasks);
                    var timeout = new Promise(function(resolve) { setTimeout(resolve, 1500); });
                    Promise.race([cleanup, timeout]).then(function() {
                      var u = new URL(window.location.href);
                      u.searchParams.set('_v', String(now));
                      window.location.replace(u.toString());
                    });
                  } catch (err) {
                    recoveryInProgress = false;
                  }
                }

                // 1. 捕获阶段监听（useCapture: true）— 仅针对真正的 JS Chunk / Module 脚本加载失败触发自愈，
                // 避免 iOS Safari 切入后台挂起普通 fetch 请求抛出的 "Load failed" / "Failed to fetch" 误触发整页强制刷新
                window.addEventListener('error', function(e) {
                  var isScript = e && e.target && (e.target.tagName === 'SCRIPT' || e.target.nodeName === 'SCRIPT');
                  var scriptSrc = isScript && e.target.src ? String(e.target.src) : '';
                  var isFirstPartyChunk = isScript && scriptSrc.indexOf('/_next/') !== -1;
                  var msg = (e && e.message) ? String(e.message) : '';
                  if (isFirstPartyChunk || /loading chunk|importing a module script failed|chunkloaderror|dynamically imported module|unexpected token '<'/i.test(msg)) {
                    autoRecoverChunkError('script_error');
                  }
                }, true);

                window.addEventListener('unhandledrejection', function(e) {
                  var reason = e ? (e.reason && (e.reason.message || e.reason.name)) || String(e.reason || '') : '';
                  if (/loading chunk|importing a module script failed|chunkloaderror|dynamically imported module/i.test(reason)) {
                    autoRecoverChunkError('unhandled_rejection');
                  }
                });

                // 3. iOS Safari 后台恢复防护：仅在页面实际渲染出错误 UI 时才自愈，不再因为后台挂起时长而强制销毁保活页面
                var markActive = function() {
                  try {
                    sessionStorage.setItem('${siteConfig.id}_last_active_ts', String(Date.now()));
                  } catch (e) {}
                };
                markActive();

                var checkWakeup = function() {
                  try {
                    if (darkMql) {
                      applySystemColorScheme(darkMql.matches);
                    }
                    // BFCache/后台恢复时仅当错误页实际存在才重建，正常状态保持长期原地保活
                    if (hasNextErrorUi()) {
                      autoRecoverChunkError('wakeup_error_ui');
                    } else {
                      markActive();
                    }
                  } catch (e) {}
                };

                window.addEventListener('pageshow', function(e) {
                  if (e.persisted) {
                    window.setTimeout(checkWakeup, 0);
                  } else {
                    markActive();
                  }
                });

                document.addEventListener('visibilitychange', function() {
                  if (document.visibilityState === 'visible') {
                    window.setTimeout(checkWakeup, 0);
                  } else {
                    markActive();
                  }
                });
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="antialiased bg-background no-scrollbar text-foreground font-sans" suppressHydrationWarning>
        <RootLayoutErrorBoundary>
          <Providers>
            <HydrationBoundary state={dehydratedState}>
              <NextIntlClientProvider locale={normalizedLocale} messages={messages} now={new Date()}>
              <RouterTransition>
              <MaintenanceGate>
                <AuthGate>
                  <DictionaryProvider locale={locale}>
                    <OfflineGate>
                      <div className="flex flex-col min-h-screen relative">
                        {/* Global Ambient Glow (Optimized for Mobile with Radial Gradients instead of heavy blurs) */}
                        <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden bg-[#F3F5F9] dark:bg-[linear-gradient(180deg,#0A0F1E_0%,#080C17_100%)]">
                          <div className="absolute -top-40 -left-40 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.06)_0%,transparent_70%)]" />
                          <div className="absolute top-[20%] right-[-15%] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.05)_0%,transparent_70%)]" />
                          <div className="absolute bottom-[-10%] left-[-10%] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(236,72,153,0.15)_0%,transparent_70%)]" />
                        </div>

                        {/* Apple ADA / WCAG 2.4.1: 跳过导航直接进入主体内容 */}
                        <a
                          href="#main-content"
                          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[99999] focus:px-4 focus:py-2.5 focus:bg-primary focus:text-primary-foreground focus:rounded-full focus:shadow-2xl focus:font-bold focus:outline-none focus:ring-2 focus:ring-white text-xs"
                        >
                          {locale === 'ko' ? '본문으로 건너뛰기' : '跳至主要内容'}
                        </a>

                        <Suspense fallback={null}>
                          <PageTracker />
                          <UmamiAnalytics />
                        </Suspense>
                        <main
                          id="main-content"
                          role="main"
                          tabIndex={-1}
                          aria-label={locale === 'ko' ? '주요 내용' : '主要内容'}
                          className="flex-1 relative z-10 outline-none"
                        >
                          <TabShellContainer>
                            {children}
                          </TabShellContainer>
                        </main>
                        <BottomNav />
                        <JobDetailOverlayHost />
                      </div>
                    </OfflineGate>
                  </DictionaryProvider>
                </AuthGate>
              </MaintenanceGate>
                      <Suspense fallback={null}>
                        <OverlayHosts />
                      </Suspense>
              </RouterTransition>
            </NextIntlClientProvider>
            </HydrationBoundary>
          </Providers>
        </RootLayoutErrorBoundary>
      </body>
    </html>
  )
}
