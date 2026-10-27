import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

// ── 版本号自动化 ──
// versionCode 由构建时间推导（单调递增，安装器才接受覆盖安装；基准 2020-01-01，单位分钟，
// 约可用到 2100 年），versionName 给人看。App 内自更新靠它比较新旧。
val versionEpochMinutes = 26297280L // 2020-01-01T00:00Z 的 epoch 分钟数
val buildVersionCode = (System.currentTimeMillis() / 60000L - versionEpochMinutes).toInt()
val buildVersionName = "1.0." + SimpleDateFormat("yyMMdd-HHmm", Locale.US).format(Date())

android {
    namespace = "com.niannote.app"
    compileSdk = 36
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.niannote.app"
        minSdk = 24
        targetSdk = 36
        versionCode = buildVersionCode
        versionName = buildVersionName
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                    getDefaultProguardFile("proguard-android-optimize.txt"),
                    "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions { jvmTarget = "1.8" }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.webkit:webkit:1.9.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}

// ── 构建后自动发布 ──
// 把 debug APK 放进热更新服务的目录并写版本元信息（服务端 /apk.json 读它，
// App 内「检查 App 更新」据此判断新旧）。因此没有任何"手动拷包"步骤。
val hotupdateApkDir = rootProject.layout.projectDirectory.dir("hotupdate/apk")
val syncDebugApkToHotupdate =
        tasks.register("syncDebugApkToHotupdate") {
            group = "hotupdate"
            description = "复制 debug APK 到 hotupdate/apk/ 并写 apk-info.json"
            dependsOn("packageDebug")
            doLast {
                val apk = layout.buildDirectory.file("outputs/apk/debug/app-debug.apk").get().asFile
                if (!apk.isFile) {
                    logger.warn("未找到 debug APK，跳过发布: ${apk.absolutePath}")
                    return@doLast
                }
                val dir = hotupdateApkDir.asFile.apply { mkdirs() }
                val dest = File(dir, "xiaoman-debug.apk")
                apk.copyTo(dest, overwrite = true)
                dest.setLastModified(apk.lastModified()) // 保留构建时间，App 侧用它判断新旧
                File(dir, "apk-info.json")
                        .writeText(
                                "{\"name\":\"xiaoman-debug.apk\"," +
                                        "\"versionCode\":$buildVersionCode," +
                                        "\"versionName\":\"$buildVersionName\"," +
                                        "\"size\":${dest.length()}," +
                                        "\"builtAt\":\"" +
                                        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
                                                .format(Date()) +
                                        "\"}"
                        )
                logger.lifecycle(
                        "已发布到热更新目录: hotupdate/apk/xiaoman-debug.apk ($buildVersionName / code $buildVersionCode)"
                )
            }
        }

tasks.matching { it.name == "assembleDebug" }.configureEach { finalizedBy(syncDebugApkToHotupdate) }
