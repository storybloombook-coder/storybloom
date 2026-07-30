# Native engines expose JNI entry points that R8 cannot discover.
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
-keep class com.googlecode.tesseract.android.** { *; }
-dontwarn com.sun.jna.**
