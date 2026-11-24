package com.jobinfinity.app

import android.content.Intent
import android.net.Uri

/** 站点域名判断与深链转换 */
object SiteUrls {

    /** 两个站点互相跳转时都留在 App 内 */
    private val INTERNAL_HOSTS = listOf(BuildConfig.SITE_HOST, "hanguo114.com", "korean114.com").distinct()

    private val CUSTOM_SCHEMES = setOf("hanguo114", "korean114")
    private val PROTOCOL_HANDLER_SCHEMES = setOf("web+hanguo", "web+korean")

    fun isInternal(uri: Uri): Boolean {
        if (uri.scheme?.lowercase() != "https") return false
        val host = uri.host?.lowercase() ?: return false
        return INTERNAL_HOSTS.any { host == it || host.endsWith(".$it") }
    }

    /** 给 addDocumentStartJavaScript 用的来源白名单：注入脚本只在自家站点运行 */
    fun allowedOriginRules(): Set<String> =
        INTERNAL_HOSTS.flatMap { listOf("https://$it", "https://*.$it") }.toSet()

    fun userAgentToken(): String =
        "JobInfinityApp/${BuildConfig.VERSION_NAME} (${BuildConfig.FLAVOR}; Android)"

    /**
     * 把外部唤起的 Intent 转成要加载的网址：
     *  - https://hanguo114.com/jobs/123     → 原样加载
     *  - hanguo114://jobs/123               → https://hanguo114.com/jobs/123
     *  - web+hanguo:xxx                     → https://hanguo114.com/?protocol=web%2Bhanguo%3Axxx（与 PWA protocol_handlers 一致）
     */
    fun fromIntent(intent: Intent): String? {
        if (intent.action != Intent.ACTION_VIEW) return null
        val data = intent.data ?: return null
        val scheme = data.scheme?.lowercase() ?: return null

        return when {
            scheme == "https" && isInternal(data) -> data.toString()
            scheme in CUSTOM_SCHEMES -> {
                val path = buildString {
                    data.host?.let { append('/').append(it) }
                    data.encodedPath?.let { append(it) }
                    data.encodedQuery?.let { append('?').append(it) }
                    data.encodedFragment?.let { append('#').append(it) }
                }
                "https://${BuildConfig.SITE_HOST}${path.ifEmpty { "/" }}"
            }
            scheme in PROTOCOL_HANDLER_SCHEMES ->
                "https://${BuildConfig.SITE_HOST}/?protocol=${Uri.encode(data.toString())}"
            else -> null
        }
    }
}
