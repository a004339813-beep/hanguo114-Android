import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
// 发布签名：优先读 apps/android/keystore.properties，其次读环境变量（CI 用）。
// 两者都没有时，release 包自动使用 debug 签名，保证 APK 仍可直接安装测试。
// ---------------------------------------------------------------------------
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

fun signingValue(propKey: String, envKey: String): String? =
    keystoreProps.getProperty(propKey) ?: System.getenv(envKey)?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")
val hasReleaseSigning = releaseStoreFile != null && file(releaseStoreFile).exists()

android {
    namespace = "com.jobinfinity.app"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
            }
        }
    }

    // 两个站点各出一个 App，代码完全共用
    flavorDimensions += "site"
    productFlavors {
        create("hanguo114") {
            dimension = "site"
            applicationId = "com.hanguo114.app"
            resValue("string", "app_name", "韩国114")
            buildConfigField("String", "START_URL", "\"https://hanguo114.com/?source=android_app\"")
            buildConfigField("String", "SITE_HOST", "\"hanguo114.com\"")
            buildConfigField("String", "SHARE_SUFFIX", "\"韩国114\"")
            manifestPlaceholders["siteHost"] = "hanguo114.com"
            manifestPlaceholders["appScheme"] = "hanguo114"
            manifestPlaceholders["webScheme"] = "web+hanguo"
        }
        create("korean114") {
            dimension = "site"
            applicationId = "com.korean114.app"
            resValue("string", "app_name", "Korean114")
            buildConfigField("String", "START_URL", "\"https://korean114.com/?source=android_app\"")
            buildConfigField("String", "SITE_HOST", "\"korean114.com\"")
            buildConfigField("String", "SHARE_SUFFIX", "\"Korean114\"")
            manifestPlaceholders["siteHost"] = "korean114.com"
            manifestPlaceholders["appScheme"] = "korean114"
            manifestPlaceholders["webScheme"] = "web+korean"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.webkit:webkit:1.13.0")
}
