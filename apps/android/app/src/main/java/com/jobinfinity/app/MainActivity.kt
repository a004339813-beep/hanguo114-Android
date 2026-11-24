package com.jobinfinity.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlin.math.max

class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View

    /** 首屏加载完成前保持启动页，最多 [SPLASH_MAX_MS] 毫秒 */
    @Volatile private var firstPageReady = false
    private var lastFailedUrl: String? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileCallback ?: return@registerForActivityResult
            fileCallback = null
            callback.onReceiveValue(parseChosenFiles(result.resultCode, result.data))
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        val splashStart = SystemClock.uptimeMillis()
        splash.setKeepOnScreenCondition {
            !firstPageReady && SystemClock.uptimeMillis() - splashStart < SPLASH_MAX_MS
        }

        enableEdgeToEdge()
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        webView = findViewById(R.id.webview)
        progressBar = findViewById(R.id.progress)
        errorView = findViewById(R.id.error_view)
        findViewById<Button>(R.id.retry_button).setOnClickListener { retry() }

        applySystemBarInsets()
        setupWebView()
        setupBackHandling()

        val restored = savedInstanceState?.let { webView.restoreState(it) } != null
        if (!restored) {
            val deepLink = intent?.let { SiteUrls.fromIntent(it) }
            webView.loadUrl(deepLink ?: BuildConfig.START_URL)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        SiteUrls.fromIntent(intent)?.let { webView.loadUrl(it) }
    }

    // ------------------------------------------------------------------ 布局 / 安全区

    /** Android 15 强制全面屏：手动把状态栏、导航栏、刘海、键盘高度留出来 */
    private fun applySystemBarInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, max(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    // ------------------------------------------------------------------ WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = true
            // 网页可通过 UA 中的 JobInfinityApp 识别自己运行在 App 内
            userAgentString = "$userAgentString ${SiteUrls.userAgentToken()}"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.addJavascriptInterface(NativeBridge(this), NativeBridge.JS_NAME)

        // 在网页任何脚本执行之前注入：原生分享 + 标记为「已安装 App」(隐藏 PWA 安装引导)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                webView, InjectedScripts.BOOTSTRAP, SiteUrls.allowedOriginRules()
            )
        }

        webView.webViewClient = AppWebViewClient()
        webView.webChromeClient = AppChromeClient()

        // 网页里的文件下载（如简历 PDF）交给系统浏览器处理
        webView.setDownloadListener { url, _, _, _, _ ->
            if (url.startsWith("http")) openExternal(Uri.parse(url))
        }
    }

    private inner class AppWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // 子 frame（如嵌入的地图、视频）照常加载，只拦截主页面跳转
            if (!request.isForMainFrame) return false
            return handleNavigation(request.url)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            progressBar.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            firstPageReady = true
            progressBar.visibility = View.GONE
            // 老版本 WebView 不支持 document-start 注入时的兜底
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                view.evaluateJavascript(InjectedScripts.BOOTSTRAP, null)
            }
            CookieManager.getInstance().flush()
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            if (request.isForMainFrame) {
                lastFailedUrl = request.url.toString()
                showError()
            }
        }

        @RequiresApi(Build.VERSION_CODES.O)
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // 渲染进程崩溃/被系统回收：重建 Activity，避免整个 App 闪退（WebView 在 onDestroy 中销毁）
            root.removeView(view)
            recreate()
            return true
        }
    }

    private inner class AppChromeClient : WebChromeClient() {

        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progressBar.progress = newProgress
            progressBar.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = filePathCallback

            val pick = fileChooserParams.createIntent().apply {
                if (fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
            }
            return try {
                fileChooserLauncher.launch(Intent.createChooser(pick, null))
                true
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                toast(R.string.no_app_found)
                false
            }
        }
    }

    private fun parseChosenFiles(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != RESULT_OK || data == null) return null
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) {
            return Array(clip.itemCount) { clip.getItemAt(it).uri }
        }
        return data.data?.let { arrayOf(it) }
    }

    // ------------------------------------------------------------------ 跳转处理

    /** @return true 表示已由 App 处理，WebView 不再加载 */
    private fun handleNavigation(uri: Uri): Boolean {
        return when (uri.scheme?.lowercase()) {
            "http", "https" -> {
                if (SiteUrls.isInternal(uri)) {
                    false
                } else {
                    openExternal(uri); true
                }
            }
            "tel" -> { safeStart(Intent(Intent.ACTION_DIAL, uri)); true }
            "sms", "smsto", "mailto" -> { safeStart(Intent(Intent.ACTION_SENDTO, uri)); true }
            "intent" -> { handleIntentScheme(uri.toString()); true }
            "about", "data", "blob", "javascript" -> false
            null -> true
            // kakaotalk:// weixin:// market:// 等第三方 App 协议
            else -> { safeStart(Intent(Intent.ACTION_VIEW, uri)); true }
        }
    }

    private fun handleIntentScheme(url: String) {
        val parsed = try {
            Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
        } catch (e: Exception) {
            return
        }
        // 安全：只允许打开可被浏览器调起的页面，不允许指定组件
        parsed.addCategory(Intent.CATEGORY_BROWSABLE)
        parsed.component = null
        parsed.selector = null

        try {
            startActivity(parsed)
            return
        } catch (e: ActivityNotFoundException) {
            // 未安装目标 App，走下面的兜底
        }

        val fallback = parsed.getStringExtra("browser_fallback_url")
        if (!fallback.isNullOrBlank()) {
            val fallbackUri = Uri.parse(fallback)
            if (SiteUrls.isInternal(fallbackUri)) webView.loadUrl(fallback) else openExternal(fallbackUri)
            return
        }
        parsed.`package`?.let { pkg ->
            safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")))
        }
    }

    private fun openExternal(uri: Uri) {
        safeStart(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
    }

    private fun safeStart(intent: Intent) {
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast(R.string.no_app_found)
        } catch (e: SecurityException) {
            toast(R.string.no_app_found)
        }
    }

    // ------------------------------------------------------------------ 离线 / 错误页

    private fun showError() {
        firstPageReady = true
        progressBar.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }

    private fun retry() {
        errorView.visibility = View.GONE
        val target = lastFailedUrl
        lastFailedUrl = null
        if (target != null) webView.loadUrl(target) else webView.reload()
    }

    // ------------------------------------------------------------------ 返回键

    private fun setupBackHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    errorView.visibility == View.VISIBLE && webView.canGoBack() -> {
                        errorView.visibility = View.GONE
                        webView.goBack()
                    }
                    // 网页里的弹窗/抽屉通过 history 管理，goBack 会先关闭它们
                    webView.canGoBack() -> webView.goBack()
                    // 已在首页：退到后台而不是销毁，下次打开秒开
                    else -> moveTaskToBack(true)
                }
            }
        })
    }

    // ------------------------------------------------------------------ 生命周期

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun toast(resId: Int) {
        Toast.makeText(this, resId, Toast.LENGTH_SHORT).show()
    }

    companion object {
        private const val SPLASH_MAX_MS = 3000L
    }
}
