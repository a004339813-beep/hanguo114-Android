package com.jobinfinity.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.webkit.JavascriptInterface

/**
 * 暴露给网页的原生能力：window.JobInfinityNative
 * 只放无副作用、不涉及隐私的方法（WebView 只加载自家域名，外链都跳系统浏览器）。
 */
class NativeBridge(private val activity: Activity) {

    /** 调起系统分享面板（微信、KakaoTalk、短信等） */
    @JavascriptInterface
    fun share(title: String?, text: String?, url: String?) {
        val body = listOfNotNull(text, url)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .joinToString("\n")
        if (body.isEmpty()) return

        activity.runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, body)
                if (!title.isNullOrBlank()) putExtra(Intent.EXTRA_SUBJECT, title)
            }
            try {
                activity.startActivity(Intent.createChooser(send, title?.takeIf { it.isNotBlank() }))
            } catch (e: ActivityNotFoundException) {
                // 没有可分享的应用，忽略
            }
        }
    }

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun platform(): String = "android"

    companion object {
        const val JS_NAME = "JobInfinityNative"
    }
}
