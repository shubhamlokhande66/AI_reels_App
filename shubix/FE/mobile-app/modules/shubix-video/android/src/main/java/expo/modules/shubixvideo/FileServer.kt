package expo.modules.shubixvideo

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
import kotlin.concurrent.thread

/** The hidden engine page's home (lib/engine.tsx): a tiny web server on the phone itself (127.0.0.1 only).
 *   GET  /engine and its files      the page, from the APK's own assets (assets/engine, built by engine/build.mjs)
 *   /api/...                        passed on to the API, so the page calls one address and needs no CORS
 * The page plays the clips and the song from it (with seeking: Range) and sends the finished Reel back to it, with the
 * key. Only files inside the app's own folders are served or written.
 *   GET  /f?k=KEY&p=PATH            a file (PATH: an absolute path or a file:// address)
 *   PUT  /out?k=KEY&name=NAME       the body is kept as <cache>/engine-out/NAME; answers its path */
class FileServer(private val roots: List<File>, private val outDir: File, private val assets: AssetManager, private val api: String) {
  val key: String = ByteArray(18).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
  // one address, so the page keeps its storage from one run to the next; any free port when another app holds it
  private val server = try { ServerSocket(47831, 16, InetAddress.getByName("127.0.0.1")) } catch (_: Exception) { ServerSocket(0, 16, InetAddress.getByName("127.0.0.1")) }
  val port: Int get() = server.localPort

  init { thread(isDaemon = true, name = "shubix-files") { while (!server.isClosed) try { val s = server.accept(); thread(isDaemon = true) { serve(s) } } catch (_: Exception) {} } }
  fun close() = try { server.close() } catch (_: Exception) {}

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
    if (url.path != "/f" && url.path != "/out") return@use page(method, url.path ?: "/", out)
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
