# JS 桥接方法必须保留，否则 release 混淆后网页调不到
-keepclassmembers class com.jobinfinity.app.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
