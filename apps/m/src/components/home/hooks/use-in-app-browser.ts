import { useState, useSyncExternalStore } from 'react'
import { copyToClipboard } from '@/lib/clipboard'
import { triggerHaptic } from '@/lib/haptics'
import { pushToast } from '@repo/shared'

export { copyToClipboard }

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

/**
 * 跨平台 Standalone 独立应用运行模式判定：
 * 1. 标准 Web App Manifest display-mode: standalone
 * 2. 部分 Android 全屏或 minimal-ui 模式
 * 3. iOS Safari standalone 模式 (navigator.standalone)
 * 4. Android WebAPK 桌面图标启动特征 (referrer 携带 android-app://)
 * 5. 安卓原生 App（apps/android）：UA 含 JobInfinityApp/
 */
export function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneNavigator = window.navigator as Navigator & { standalone?: boolean }
  return Boolean(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    Boolean(standaloneNavigator.standalone) ||
    document.referrer.includes('android-app://') ||
    // 安卓原生壳 App（apps/android）UA 带 JobInfinityApp 标记
    /JobInfinityApp\//i.test(window.navigator.userAgent)
  )
}

/**
 * 实时响应 Standalone 状态变化及安装成功事件
 */
export function subscribePwaStandalone(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const mqlStandalone = window.matchMedia?.('(display-mode: standalone)')
  const mqlFullscreen = window.matchMedia?.('(display-mode: fullscreen)')
  const mqlMinimal = window.matchMedia?.('(display-mode: minimal-ui)')

  mqlStandalone?.addEventListener?.('change', callback)
  mqlFullscreen?.addEventListener?.('change', callback)
  mqlMinimal?.addEventListener?.('change', callback)
  window.addEventListener('appinstalled', callback)

  return () => {
    mqlStandalone?.removeEventListener?.('change', callback)
    mqlFullscreen?.removeEventListener?.('change', callback)
    mqlMinimal?.removeEventListener?.('change', callback)
    window.removeEventListener('appinstalled', callback)
  }
}

const emptySubscribe = () => () => {}
const getUserAgent = () => (typeof window !== 'undefined' ? window.navigator.userAgent.toLowerCase() : '')

// iPhone/iPod touch、iPadOS 13 之前的 iPad；iPadOS 13+ 默认请求桌面网站，UA 伪装成 Mac，靠多点触控识别
const getIsIOS = () => {
  if (typeof window === 'undefined') return false
  try {
    const sp = new URLSearchParams(window.location.search)
    if (sp.has('ios_v') || sp.has('ios_version') || sp.get('simulate_os') === 'ios') return true
  } catch {}
  const ua = getUserAgent()
  if (/iphone|ipad|ipod/.test(ua)) return true
  if (/macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) return true
  return false
}

// iOS 主版本号识别：
// 1. 支持 URL 参数 ?ios_v=27 或 ?ios_version=27 优先覆盖（方便测试与 QA 验收）
// 2. 特征感知（Feature Detection）：Safari 27+ 原生支持 Service Worker static routing (addRoutes)
// 3. User-Agent 深度解析：
//    【核心关键】苹果在 iOS 26+ 中实施了 User-Agent 隐私冻结策略（UA Freeze）：
//    真实 iPhone 上的「CPU iPhone OS」字段被永久固定为 18_6！
//    而真正的 Safari / iOS 系统主版本号体现在「Version/XX.X」字段中！
//    如果仅匹配 OS (\d+) 会误将所有真机 iOS 26/27 识别为 18！
//    因此必须取 Math.max(versionToken, osToken) 并结合特征探测。
export const getIOSMajorVersion = () => {
  if (typeof window === 'undefined') return 0
  try {
    const sp = new URLSearchParams(window.location.search)
    const testV = sp.get('ios_v') || sp.get('ios_version')
    if (testV) {
      const parsed = parseInt(testV, 10)
      if (!isNaN(parsed) && parsed > 0) return parsed
    }
  } catch {}

  // 特征探测：Safari 27 引入了 addRoutes
  if (typeof ServiceWorkerRegistration !== 'undefined' && 'addRoutes' in ServiceWorkerRegistration.prototype) {
    return 27
  }

  const ua = window.navigator.userAgent
  let maxV = 0

  // 1. 优先提取 Safari/WebKit 真实版本号 Version/XX（iOS 26/27 真机中 OS 被冻结为 18_6，Version/ 才是真实系统对应版本）
  const versionMatch = ua.match(/Version\/(\d+)(?:\.\d+)?/i)
  if (versionMatch) {
    const v = parseInt(versionMatch[1], 10)
    if (!isNaN(v) && v > maxV) maxV = v
  }

  // 2. 兼容旧版 iOS（iOS 18 及更早未冻结系统的 OS XX_）
  const iosMatch = ua.match(/OS (\d+)(?:_\d+)?/i)
  if (iosMatch) {
    const v = parseInt(iosMatch[1], 10)
    if (!isNaN(v) && v > maxV) maxV = v
  }

  return maxV
}

// iOS 26（Liquid Glass）起 Safari 改为「⋯菜单 → 共享」入口，并出现「作为网页 App 打开」开关（默认关闭）
export const getIsIOS26Plus = () => {
  if (getIOSMajorVersion() >= 26) return true
  if (typeof ServiceWorkerRegistration !== 'undefined' && 'addRoutes' in ServiceWorkerRegistration.prototype) {
    return true
  }
  return false
}

// iOS 27 起该开关成为安装必经步骤
export const getIsIOS27Plus = () => {
  if (getIOSMajorVersion() >= 27) return true
  if (typeof ServiceWorkerRegistration !== 'undefined' && 'addRoutes' in ServiceWorkerRegistration.prototype) {
    return true
  }
  return false
}

// 第三方 App 内置浏览器 / WebView，无法在当前环境安装真 PWA，必须引导跳 Safari（iOS）或系统浏览器（Android）
// 覆盖：中国系（微信/QQ/支付宝/抖音/小红书/微博/百度）+ 韩国系（KakaoTalk/Naver/Line）+ 海外系（FB/IG/Telegram/TikTok）
const getIsInAppBrowser = () =>
  /micromessenger|qqtheme|qqclient|baidu|alipay|aweme|douyin|weibo|xhs|rednote|kakaotalk|naver\(inapp|line\/|fban|fbav|fbios|instagram|telegram|tiktok|musical_ly/.test(getUserAgent())

// iOS 上只有 Safari 支持完整的 PWA 安装（添加到主屏幕 + Web App 模式），
// CriOS/FxiOS/EdgiOS 等第三方浏览器及所有 WebView 均不支持
const getIsSafari = () => {
  if (typeof window === 'undefined') return false
  try {
    const sp = new URLSearchParams(window.location.search)
    if (sp.has('ios_v') || sp.has('ios_version') || sp.get('simulate_os') === 'ios') return true
  } catch {}
  const ua = getUserAgent()
  return /safari/.test(ua)
    && !/crios|fxios|edgios|opios|mercury|apollo|quark|mqqbrowser|ucbrowser|maxthon|sogou|liebao|2345|kakaotalk|naver\(inapp|line\/|fban|fbav|fbios|instagram|telegram|tiktok|musical_ly|aweme|douyin|micromessenger|qqtheme|qqclient|alipay|weibo|xhs|rednote|baidu/.test(ua)
}

const getIsAndroid = () => {
  if (typeof window === 'undefined') return false
  try {
    const sp = new URLSearchParams(window.location.search)
    if (sp.has('ios_v') || sp.has('ios_version') || sp.get('simulate_os') === 'ios') return false
  } catch {}
  return /android/.test(getUserAgent()) && !getIsIOS()
}

// Android 浏览器族（判定顺序即优先级）：
// 1. 三星 UA 同时带 chrome 标识，必须先判定，其菜单位于右下角且文案不同
// 2. Firefox 独立路径（菜单 → 安装）
// 3. 国产/第三方壳（UC/QQ/夸克/小米/华为/OPPO/vivo/搜狗/360/百度等）UA 多带 chrome 字样，必须在 chromium 前排除，走通用教程
// 4. Chromium 系（Chrome/Edge/Opera/Whale）支持 beforeinstallprompt 原生弹窗
export type AndroidBrowserKind = 'chromium' | 'samsung' | 'firefox' | 'other'
const getAndroidBrowserKind = (): AndroidBrowserKind => {
  try {
    const sp = new URLSearchParams(window.location.search)
    const forcedKind = sp.get('android_browser')
    if (forcedKind === 'samsung' || forcedKind === 'firefox' || forcedKind === 'chromium' || forcedKind === 'other') {
      return forcedKind
    }
  } catch {}
  const ua = getUserAgent()
  if (/samsungbrowser/.test(ua)) return 'samsung'
  if (/firefox/.test(ua)) return 'firefox'
  if (/ucbrowser|mqqbrowser|quark|miuibrowser|huaweibrowser|vivobrowser|heytapbrowser|oppobrowser|sogou|360browser|baidubrowser|maxthon|liebao|2345/.test(ua)) return 'other'
  if (/chrome|chromium|edga|opr\/|whale/.test(ua)) return 'chromium'
  return 'other'
}

export function getAutoInstallUrl() {
  if (typeof window === 'undefined') return ''
  try {
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.set('auto_install', '1')
    return currentUrl.toString()
  } catch {
    return window.location.href
  }
}

export function launchExternalBrowser() {
  if (typeof window === 'undefined') return
  try {
    const fullUrl = getAutoInstallUrl()
    const urlObj = new URL(fullUrl)
    const scheme = urlObj.protocol.replace(':', '') || 'https'
    const hostAndPath = fullUrl.replace(/^https?:\/\//, '')

    // 1. Intent targeting Chrome browser specifically
    const chromeIntent = `intent://${hostAndPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;component=com.android.chrome/com.google.android.apps.chrome.Main;end;`

    // 2. Intent targeting default system browser
    const genericIntent = `intent://${hostAndPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end;`

    // 3. Chrome app scheme
    const chromeScheme = `googlechrome://navigate?url=${encodeURIComponent(fullUrl)}`

    // Multi-stage intent dispatching
    window.location.href = chromeIntent

    setTimeout(() => {
      window.location.href = genericIntent
    }, 200)

    setTimeout(() => {
      window.location.href = chromeScheme
    }, 450)
  } catch (e) {
    console.error('Failed to launch external browser intent', e)
  }
}

export function markPendingCelebration() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('job_infinity_pending_celebration', Date.now().toString())
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.set('auto_install', '1')
    window.history.replaceState(window.history.state, '', currentUrl.toString())
  } catch (e) {
    console.error('Failed to mark pending celebration', e)
  }
}

export async function triggerPwaInstall(): Promise<'native_prompt_shown' | 'fallback_dispatched'> {
  if (typeof window === 'undefined') return 'fallback_dispatched'

  const win = window as Window & {
    __jiBip?: BeforeInstallPromptEvent | null
    __pendingPwaPrompt?: boolean
  }
  const bip = win.__jiBip

  // 1. 若当前在任何支持原生安装的 Chromium 系浏览器（Chrome / Edge / 三星 / Whale / Opera 等）且已捕获到原生 beforeinstallprompt 事件：
  //    直接在当次用户点击手势内调用 prompt()，一步弹出系统安装窗，免除多余抽屉
  if (bip) {
    try {
      await bip.prompt()
      const { outcome } = await bip.userChoice
      if (outcome === 'accepted') {
        win.__jiBip = null
        localStorage.setItem('job_infinity_install_done_v2', 'true')
        localStorage.setItem('job_infinity_pwa_installed_v1', 'true')
        triggerHaptic('SUCCESS')
        try {
          const isKo = typeof document !== 'undefined' && document.documentElement.lang === 'ko'
          pushToast(isKo ? '홈 화면에 앱 추가가 시작되었습니다' : '正在添加到桌面，请查看手机桌面图标', 'success')
        } catch {}
      }
      return 'native_prompt_shown'
    } catch {
      // 若原生活动 Token 失效，走兜底指引
    }
  }

  // 2. 兜底方案（iOS Safari 教程、三星/火狐等浏览器指引、应用内遮罩）：
  win.__pendingPwaPrompt = true
  window.dispatchEvent(new CustomEvent('trigger_pwa_install_prompt', { detail: { direct: true } }))
  return 'fallback_dispatched'
}

export function useInAppBrowser() {
  const isIOS = useSyncExternalStore(emptySubscribe, getIsIOS, () => false)
  const isIOS26Plus = useSyncExternalStore(emptySubscribe, getIsIOS26Plus, () => false)
  const isIOS27Plus = useSyncExternalStore(emptySubscribe, getIsIOS27Plus, () => false)
  const isSafari = useSyncExternalStore(emptySubscribe, getIsSafari, () => false)
  const isAndroid = useSyncExternalStore(emptySubscribe, getIsAndroid, () => false)
  const androidBrowserKind = useSyncExternalStore(emptySubscribe, getAndroidBrowserKind, () => 'other' as AndroidBrowserKind)
  const isInAppBrowser = useSyncExternalStore(emptySubscribe, getIsInAppBrowser, () => false)
  const [showInAppMask, setShowInAppMask] = useState(false)

  return {
    isIOS,
    isIOS26Plus,
    isIOS27Plus,
    isSafari,
    isAndroid,
    androidBrowserKind,
    isInAppBrowser,
    showInAppMask,
    setShowInAppMask,
  }
}
