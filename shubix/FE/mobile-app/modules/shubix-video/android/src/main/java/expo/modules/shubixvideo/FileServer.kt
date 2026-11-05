package expo.modules.shubixvideo

import android.content.Context
import android.content.res.AssetManager
import android.net.Uri
import java.io.BufferedInputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** The hidden engine page's home (lib/engine.tsx): a tiny web server on the phone itself (127.0.0.1 only).
 *   GET  /engine and its files      the page, from the APK's own assets (assets/engine, built by engine/build.mjs)
 *   /api/...                        passed on to the API, so the page calls one address and needs no CORS
 * The page plays the clips and the song from it (with seeking: Range) and sends the finished Reel back to it, with the
 * key. Only files inside the app's own folders are served or written.
 *   GET  /f?k=KEY&p=PATH            a file (PATH: an absolute path or a file:// address)
 *   POST /frames?k=KEY&p=PATH&w=W&h=H  a clip's frames at the times in the body, comma separated (FrameReader.kt)
 *   GET  /sound?k=KEY&p=PATH        a file's sound, decoded (SoundReader.kt)
 *   POST /copy?k=KEY&p=PATH&w=W&h=H&fps=F&b=BITRATE  a heavy clip's edit copy; answers its path (EditCopy.kt)
 *   PUT  /out?k=KEY&name=NAME       the body is kept as <cache>/engine-out/NAME; answers its path
 *   POST /model?k=KEY&u=MODEL       the model is downloaded when needed: lines of progress, then "ok" (Models.kt)
 *   GET  /model?k=KEY               how many runs the models have done
 *   POST /onnx?k=KEY&u=MODEL        one run of a model
 *   POST /speech?k=KEY&u=MODEL      the chance of speech in a 16 kHz sound
 *   POST /scan?k=KEY&p=PATH&dur=D   a clip's samples and scene changes (ClipScan.kt): lines of progress, then a line of JSON
 *   POST /song?k=KEY                the song's beats and cuts (SongAnalysis.kt); the body is as songFromRequest reads it
 *   POST /speak?k=KEY&v=LANGUAGE    the body's words spoken by the phone's voice: floats, with X-Sample-Rate (SystemVoice.kt) */
@androidx.media3.common.util.UnstableApi
class FileServer(private val context: Context, private val roots: List<File>, private val outDir: File, private val api: String) {
  private val assets: AssetManager = context.assets
  val key: String = ByteArray(18).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
  // one address, so the page keeps its storage from one run to the next; any free port when another app holds it
  private val server = try { ServerSocket(47831, 16, InetAddress.getByName("127.0.0.1")) } catch (_: Exception) { ServerSocket(0, 16, InetAddress.getByName("127.0.0.1")) }
  val port: Int get() = server.localPort
  private val decoders = Semaphore(3, true)
  private val copies = Semaphore(1, true)
  private val models = Models(File(context.filesDir, "models"), api)
  private val voice = SystemVoice(context, outDir)

  init { thread(isDaemon = true, name = "shubix-files") { while (!server.isClosed) try { val s = server.accept(); thread(isDaemon = true) { serve(s) } } catch (_: Exception) {} } }
  fun close() { try { server.close() } catch (_: Exception) {}; voice.close() }

  private fun inside(f: File) = roots.any { f.canonicalPath.startsWith(it.canonicalPath + File.separator) }

  private fun serve(s: Socket) = s.use {
    val input = BufferedInputStream(s.getInputStream()); val out = s.getOutputStream()
    val head = readLine(input) ?: return@use
    val (method, target) = head.split(" ").let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "/") }
    val headers = HashMap<String, String>()
    while (true) { val l = readLine(input) ?: break; if (l.isEmpty()) break; val i = l.indexOf(':'); if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim() }
    val url = Uri.parse("http://x$target")
    if (method == "OPTIONS") return@use reply(out, 204, "No Content", emptyMap(), null)
    if (url.path?.startsWith("/api/") == true) return@use proxy(method, target, headers, input, out)
    if (url.path != "/f" && url.path != "/out" && url.path != "/frames" && url.path != "/sound" && url.path != "/copy" && url.path != "/model" && url.path != "/onnx" && url.path != "/speech" && url.path != "/speak" && url.path != "/song" && url.path != "/scan") return@use page(method, url.path ?: "/", out)
    if (url.getQueryParameter("k") != key) return@use reply(out, 403, "Forbidden", emptyMap(), "no key".toByteArray())
    when {
      url.path == "/f" && (method == "GET" || method == "HEAD") -> {
        val p = url.getQueryParameter("p") ?: ""
        val f = File(if (p.startsWith("file:")) Uri.parse(p).path ?: "" else p)
        if (!f.isFile || !inside(f)) return@use reply(out, 404, "Not Found", emptyMap(), null)
        val len = f.length(); var a = 0L; var b = len - 1; var status = 200
        Regex("bytes=(\\d*)-(\\d*)").find(headers["range"] ?: "")?.let { m ->
          val (x, y) = m.destructured
          if (x.isEmpty()) { a = maxOf(0, len - (y.toLongOrNull() ?: 0)) } else { a = x.toLong(); if (y.isNotEmpty()) b = minOf(len - 1, y.toLong()) }
          status = 206
        }
        if (a > b || a >= len) return@use reply(out, 416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$len"), null)
        val h = mutableMapOf("Content-Type" to typeOf(f.name), "Accept-Ranges" to "bytes", "Content-Length" to (b - a + 1).toString())
        if (status == 206) h["Content-Range"] = "bytes $a-$b/$len"
        write(out, status, if (status == 206) "Partial Content" else "OK", h)
        if (method == "GET") RandomAccessFile(f, "r").use { r -> r.seek(a); val buf = ByteArray(256 * 1024); var left = b - a + 1
          while (left > 0) { val n = r.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (n <= 0) break; out.write(buf, 0, n); left -= n } }
        out.flush()
      }
      url.path == "/model" && method == "GET" -> reply(out, 200, "OK", mapOf("Content-Type" to "text/plain"), models.runs.get().toString().toByteArray())
      url.path == "/model" && method == "POST" -> {
        write(out, 200, "OK", mapOf("Content-Type" to "text/plain"))
        // Throwable: a phone that cannot load the runtime gets an answer too, and the page uses its own copy
        try { models.fetch(url.getQueryParameter("u") ?: "") { p -> out.write("$p\n".toByteArray()); out.flush() }; out.write("ok\n".toByteArray()) }
        catch (e: Throwable) { out.write("${(e.message ?: "no model").replace('\n', ' ').ifBlank { "no model" }}\n".toByteArray()) }
        out.flush()
      }
      url.path == "/onnx" && method == "POST" -> {
        val body = ByteArray((headers["content-length"]?.toIntOrNull() ?: 0).coerceIn(0, 64_000_000)); var read = 0
        while (read < body.size) { val n = input.read(body, read, body.size - read); if (n <= 0) break; read += n }
        try { reply(out, 200, "OK", mapOf("Content-Type" to "application/octet-stream"), models.run(url.getQueryParameter("u") ?: "", body)) }
        catch (e: Throwable) { reply(out, 500, "Model failed", mapOf("Content-Type" to "text/plain"), (e.message ?: "model failed").toByteArray()) }
      }
      url.path == "/scan" && method == "POST" -> {
        val f = File(url.getQueryParameter("p") ?: ""); val dur = url.getQueryParameter("dur")?.toDoubleOrNull() ?: 0.0
        if (!f.isFile || !inside(f) || dur <= 0) return@use reply(out, 404, "Not Found", emptyMap(), null)
        if (!decoders.tryAcquire(30, TimeUnit.SECONDS)) return@use reply(out, 503, "Busy", emptyMap(), null)
        write(out, 200, "OK", mapOf("Content-Type" to "text/plain"))
        try { out.write((scanFile(f, dur) { p -> out.write("$p\n".toByteArray()); out.flush() }.toJson().toString() + "\n").toByteArray()) }
        catch (e: Throwable) { out.write("${(e.message ?: "no scan").replace('\n', ' ').ifBlank { "no scan" }}\n".toByteArray()) }
        finally { decoders.release(); out.flush() }
      }
      url.path == "/song" && method == "POST" -> {
        val body = ByteArray((headers["content-length"]?.toIntOrNull() ?: 0).coerceIn(0, 400_000_000)); var read = 0
        while (read < body.size) { val n = input.read(body, read, body.size - read); if (n <= 0) break; read += n }
        try { reply(out, 200, "OK", mapOf("Content-Type" to "application/json"), songFromRequest(body).toString().toByteArray()) }
        catch (e: Throwable) { reply(out, 500, "Song failed", mapOf("Content-Type" to "text/plain"), (e.message ?: "song failed").toByteArray()) }
      }
      url.path == "/speech" && method == "POST" -> {
        try {
          val probs = models.speech(url.getQueryParameter("u") ?: "", input, headers["content-length"]?.toLongOrNull() ?: 0L)
          val bytes = java.nio.ByteBuffer.allocate(probs.size * 4).order(java.nio.ByteOrder.LITTLE_ENDIAN); bytes.asFloatBuffer().put(probs)
          reply(out, 200, "OK", mapOf("Content-Type" to "application/octet-stream"), bytes.array())
        } catch (e: Throwable) { reply(out, 500, "Model failed", mapOf("Content-Type" to "text/plain"), (e.message ?: "model failed").toByteArray()) }
      }
      url.path == "/speak" && method == "POST" -> {
        val body = ByteArray((headers["content-length"]?.toIntOrNull() ?: 0).coerceIn(0, 200_000)); var read = 0
        while (read < body.size) { val n = input.read(body, read, body.size - read); if (n <= 0) break; read += n }
        try {
          val (pcm, rate) = voice.speak(String(body, 0, read), url.getQueryParameter("v") ?: "")
          val bytes = java.nio.ByteBuffer.allocate(pcm.size * 4).order(java.nio.ByteOrder.LITTLE_ENDIAN); bytes.asFloatBuffer().put(pcm)
          reply(out, 200, "OK", mapOf("Content-Type" to "application/octet-stream", "X-Sample-Rate" to rate.toString()), bytes.array())
        } catch (e: Throwable) { reply(out, 500, "Voice failed", mapOf("Content-Type" to "text/plain"), (e.message ?: "voice failed").toByteArray()) }
      }
      url.path == "/copy" && method == "POST" -> {
        val f = File(url.getQueryParameter("p") ?: "")
        val w = url.getQueryParameter("w")?.toIntOrNull() ?: 0; val h = url.getQueryParameter("h")?.toIntOrNull() ?: 0
        val fps = url.getQueryParameter("fps")?.toFloatOrNull() ?: 30f; val rate = url.getQueryParameter("b")?.toIntOrNull() ?: 6_000_000
        if (!f.isFile || !inside(f) || w !in 2..3840 || h !in 2..3840) return@use reply(out, 404, "Not Found", emptyMap(), null)
        // the same clip at the same size is made once
        val to = File(outDir.apply { mkdirs() }, "copy-${(f.path + f.length() + f.lastModified() + w + h + fps + rate).hashCode().toUInt()}.mp4")
        copies.acquire()   // the phone's hardware encoder: one copy at a time; the others wait for their turn
        try {
          if (!to.isFile || to.length() == 0L) makeEditCopy(context, f, to, w, h, fps, rate)
          reply(out, 200, "OK", mapOf("Content-Type" to "application/json"), "{\"path\":${org.json.JSONObject.quote(to.absolutePath)}}".toByteArray())
        } catch (e: Exception) { reply(out, 422, "Unreadable", mapOf("Content-Type" to "text/plain"), (e.message ?: "no copy").toByteArray()) }
        finally { copies.release() }
      }
      url.path == "/sound" && method == "GET" -> {
        val f = File(url.getQueryParameter("p") ?: "")
        if (!f.isFile || !inside(f)) return@use reply(out, 404, "Not Found", emptyMap(), null)
        if (!decoders.tryAcquire(30, TimeUnit.SECONDS)) return@use reply(out, 503, "Busy", emptyMap(), null)
        var began = false
        try { readSound(f, out) { began = true; write(out, 200, "OK", mapOf("Content-Type" to "application/octet-stream")) } }
        catch (e: Exception) { if (!began) reply(out, 422, "Unreadable", emptyMap(), null) }
        finally { decoders.release() }
      }
      url.path == "/frames" && method == "POST" -> {
        val f = File(url.getQueryParameter("p") ?: "")
        val w = url.getQueryParameter("w")?.toIntOrNull() ?: 0; val h = url.getQueryParameter("h")?.toIntOrNull() ?: 0
        if (!f.isFile || !inside(f) || w !in 2..2048 || h !in 2..2048) return@use reply(out, 404, "Not Found", emptyMap(), null)
        val body = ByteArray((headers["content-length"]?.toIntOrNull() ?: 0).coerceIn(0, 4_000_000)); var read = 0
        while (read < body.size) { val n = input.read(body, read, body.size - read); if (n <= 0) break; read += n }
        val times = String(body, 0, read).split(',').mapNotNull { it.toDoubleOrNull() }.toDoubleArray()
        // the phone has few hardware decoders: at most three clips at a time; waiting too long, the page reads it itself
        if (!decoders.tryAcquire(30, TimeUnit.SECONDS)) return@use reply(out, 503, "Busy", emptyMap(), null)
        var began = false
        try { readFrames(f, w, h, times, out) { began = true; write(out, 200, "OK", mapOf("Content-Type" to "application/octet-stream")) } }
        catch (e: Exception) { if (!began) reply(out, 422, "Unreadable", emptyMap(), null) }
        finally { decoders.release() }
      }
      url.path == "/out" && (method == "PUT" || method == "POST") -> {
        val name = (url.getQueryParameter("name") ?: "reel.mp4").replace(Regex("[^A-Za-z0-9._-]"), "_")
        val f = File(outDir.apply { mkdirs() }, name); var left = headers["content-length"]?.toLongOrNull() ?: -1L
        f.outputStream().use { o -> val buf = ByteArray(256 * 1024)
          while (left != 0L) { val n = input.read(buf, 0, if (left < 0) buf.size else minOf(buf.size.toLong(), left).toInt()); if (n <= 0) break; o.write(buf, 0, n); if (left > 0) left -= n } }
        reply(out, 200, "OK", mapOf("Content-Type" to "application/json"), "{\"path\":\"${f.absolutePath.replace("\\", "/")}\"}".toByteArray())
      }
      else -> reply(out, 404, "Not Found", emptyMap(), null)
    }
  }

  /** a file of the page, from the APK */
  private fun page(method: String, path: String, out: OutputStream) {
    if (method != "GET" && method != "HEAD" || path.contains("..")) return reply(out, 404, "Not Found", emptyMap(), null)
    val body = try { assets.open("engine" + if (path == "/engine") "/index.html" else path).use { it.readBytes() } } catch (_: FileNotFoundException) { return reply(out, 404, "Not Found", emptyMap(), null) }
    reply(out, 200, "OK", mapOf("Content-Type" to pageType(path), "Cache-Control" to "no-cache"), if (method == "HEAD") null else body)
  }

  /** the page's call to the API: sent on as it is (its sign-in included), the answer streamed back */
  private fun proxy(method: String, target: String, headers: Map<String, String>, input: InputStream, out: OutputStream) {
    try {
      val c = URL(api + target).openConnection() as HttpURLConnection
      c.requestMethod = method; c.connectTimeout = 240_000; c.readTimeout = 900_000
      headers.filterKeys { it !in setOf("host", "origin", "referer", "connection", "content-length", "accept-encoding") }.forEach { (k, v) -> c.setRequestProperty(k, v) }
      val size = headers["content-length"]?.toLongOrNull() ?: 0L
      if (size > 0) { c.doOutput = true; c.setFixedLengthStreamingMode(size); c.outputStream.use { o -> copy(input, o, size) } }
      val code = c.responseCode
      val h = listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control", "ETag", "Retry-After").mapNotNull { k -> c.getHeaderField(k)?.let { k to it } }.toMap()
      write(out, code, c.responseMessage ?: "OK", h)
      (if (code >= 400) c.errorStream else c.inputStream)?.use { i -> copy(i, out, -1L) }
      out.flush()
    } catch (e: Exception) { reply(out, 502, "Bad Gateway", mapOf("Content-Type" to "application/json"), "{\"error\":\"The app could not reach the server.\"}".toByteArray()) }
  }
  private fun copy(from: InputStream, to: OutputStream, size: Long) {
    val buf = ByteArray(64 * 1024); var left = size
    while (left != 0L) { val n = from.read(buf, 0, if (left < 0) buf.size else minOf(buf.size.toLong(), left).toInt()); if (n <= 0) break; to.write(buf, 0, n); to.flush(); if (left > 0) left -= n }
  }
  private fun pageType(p: String) = when (p.substringAfterLast('.', "html").lowercase()) {
    "js", "mjs" -> "text/javascript"; "css" -> "text/css"; "wasm" -> "application/wasm"; "json" -> "application/json"; "svg" -> "image/svg+xml"
    "webp" -> "image/webp"; "png" -> "image/png"; "woff2" -> "font/woff2"; "woff" -> "font/woff"; "data" -> "application/octet-stream"; else -> "text/html; charset=utf-8"
  }

  private fun readLine(i: InputStream): String? { val sb = StringBuilder(); while (true) { val c = i.read(); if (c < 0) return if (sb.isEmpty()) null else sb.toString(); if (c == '\n'.code) return sb.toString().trimEnd('\r'); sb.append(c.toChar()) } }
  private fun write(o: OutputStream, code: Int, text: String, h: Map<String, String>) {
    val all = mapOf("Access-Control-Allow-Origin" to "*", "Access-Control-Allow-Methods" to "GET, HEAD, PUT, POST, OPTIONS", "Access-Control-Allow-Headers" to "Range, Content-Type",
      "Access-Control-Expose-Headers" to "Content-Range, Content-Length, Accept-Ranges", "Access-Control-Allow-Private-Network" to "true", "Connection" to "close") + h
    o.write(("HTTP/1.1 $code $text\r\n" + all.entries.joinToString("") { "${it.key}: ${it.value}\r\n" } + "\r\n").toByteArray())
  }
  private fun reply(o: OutputStream, code: Int, text: String, h: Map<String, String>, body: ByteArray?) { write(o, code, text, h + ("Content-Length" to (body?.size ?: 0).toString())); body?.let { o.write(it) }; o.flush() }
  private fun typeOf(n: String) = when (n.substringAfterLast('.').lowercase()) {
    "mp4", "m4v" -> "video/mp4"; "mov" -> "video/quicktime"; "webm" -> "video/webm"; "3gp" -> "video/3gpp"; "mkv" -> "video/x-matroska"
    "mp3" -> "audio/mpeg"; "m4a", "aac" -> "audio/mp4"; "wav" -> "audio/wav"; "ogg", "opus" -> "audio/ogg"; "flac" -> "audio/flac"
    "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; "webp" -> "image/webp"; "heic" -> "image/heic"; else -> "application/octet-stream"
  }
}
