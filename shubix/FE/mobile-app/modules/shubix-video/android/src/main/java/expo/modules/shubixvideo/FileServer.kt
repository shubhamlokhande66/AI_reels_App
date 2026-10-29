package expo.modules.shubixvideo

import android.net.Uri
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import kotlin.concurrent.thread

/** The engine page's way to this phone's files (lib/engine.tsx): a tiny web server on the phone itself (127.0.0.1 only,
 * every request with the key). The website's engine plays the clips and the song from it (with seeking: Range) and
 * sends the finished Reel back to it. Only files inside the app's own folders are served or written.
 *   GET  /f?k=KEY&p=PATH            a file (PATH: an absolute path or a file:// address)
 *   PUT  /out?k=KEY&name=NAME       the body is kept as <cache>/engine-out/NAME; answers its path */
class FileServer(private val roots: List<File>, private val outDir: File) {
  val key: String = ByteArray(18).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
  private val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
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
