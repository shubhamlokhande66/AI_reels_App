package expo.modules.shubixvideo

import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/** The AI models on the phone itself, with ONNX Runtime for Android: the beat tracker, the speech finder, the person mask
 * and the faces. Each file is downloaded once into `dir`. No Android class is used here, so a computer can
 * run this file against the same models (scripts/models-check.mjs).
 * A run's body and answer: 4 bytes (little endian) with the length of a JSON list of {n: name, t: type, d: dims, l: bytes},
 * then the tensors' bytes, little endian, one after another. */
class Models(private val dir: File, private val api: String) {
  private class Held(val session: OrtSession, val bytes: Long, @Volatile var used: Long)
  private val env by lazy { OrtEnvironment.getEnvironment() }
  private val open = ConcurrentHashMap<String, Held>()
  // runs share the lock; closing a model waits until no run is using one
  private val gate = ReentrantReadWriteLock()
  private val downloading = Any()
  /** runs so far: a test can see that the phone's model did the work, and not the page's copy */
  val runs = AtomicLong()

  private fun fileOf(url: String): File {
    if (!url.startsWith("/api/studio/model/") || url.contains("..")) throw IllegalArgumentException("Not a model of this app")
    val name = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    return File(dir.apply { mkdirs() }, "$name.onnx")
  }

  /** The model's file, downloaded when it is not here yet. A file only gets its name once it is complete. */
  fun fetch(url: String, onProgress: (Float) -> Unit) {
    val to = fileOf(url)
    synchronized(downloading) {
      if (to.isFile) return onProgress(1f)
      val part = File(to.path + ".part")
      try {
        val c = URL(api + url).openConnection() as HttpURLConnection
        c.connectTimeout = 30_000; c.readTimeout = 120_000
        if (c.responseCode != 200) throw IllegalStateException("Model download failed (${c.responseCode})")
        val total = c.contentLengthLong; var got = 0L; var told = 0L
        c.inputStream.use { i -> part.outputStream().use { o ->
          val buf = ByteArray(256 * 1024)
          while (true) {
            val n = i.read(buf); if (n < 0) break
            o.write(buf, 0, n); got += n
            if (total > 0 && got - told > total / 50) { told = got; onProgress(got.toFloat() / total) }
          }
        } }
        if (total > 0 && got != total) throw IllegalStateException("Model download was cut short")
        if (!part.renameTo(to)) throw IllegalStateException("Model could not be kept")
        onProgress(1f)
      } finally { part.delete() }
    }
  }

  private fun load(url: String) = gate.write {
    if (open.containsKey(url)) return@write
    val file = fileOf(url)
    if (!file.isFile) throw IllegalStateException("Model not downloaded")
    val options = OrtSession.SessionOptions().apply {
      setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      setInterOpNumThreads(1)
      // a tiny model is fastest on one thread
      setIntraOpNumThreads(if (file.length() < SMALL) 1 else minOf(4, maxOf(1, Runtime.getRuntime().availableProcessors() - 1)))
    }
    // a file that does not open is not kept: the next time it is downloaded again
    val session = try { env.createSession(file.path, options) } catch (e: Exception) { file.delete(); throw e } finally { options.close() }
    open[url] = Held(session, file.length(), System.nanoTime())
    // the phone's memory: the models used longest ago go, and open again when they are needed
    while (open.values.sumOf { it.bytes } > MAX_OPEN && open.size > 1) {
      val oldest = open.entries.filter { it.key != url }.minByOrNull { it.value.used } ?: break
      open.remove(oldest.key)?.session?.close()
    }
  }

  private fun <T> using(url: String, job: (OrtSession) -> T): T {
    while (true) {
      gate.read { open[url]?.let { it.used = System.nanoTime(); runs.incrementAndGet(); return job(it.session) } }
      load(url)
    }
  }

  /** One run of a model (the format is at the top of this file). */
  fun run(url: String, body: ByteArray): ByteArray = using(url) { session ->
    val all = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN)
    val headLength = all.int
    val head = JSONArray(String(body, 4, headLength))
    var at = 4 + headLength
    val feeds = LinkedHashMap<String, OnnxTensor>()
    try {
      for (k in 0 until head.length()) {
        val t = head.getJSONObject(k); val dims = t.getJSONArray("d"); val length = t.getInt("l")
        val shape = LongArray(dims.length()) { dims.getLong(it) }
        val bytes = ByteBuffer.wrap(body, at, length).slice().order(ByteOrder.LITTLE_ENDIAN)
        feeds[t.getString("n")] = when (t.getString("t")) {
          "float32" -> OnnxTensor.createTensor(env, bytes.asFloatBuffer(), shape)
          "int64" -> OnnxTensor.createTensor(env, bytes.asLongBuffer(), shape)
          else -> throw IllegalArgumentException("Tensor type ${t.getString("t")}")
        }
        at += length
      }
      session.run(feeds).use { result ->
        val list = JSONArray(); val parts = ArrayList<ByteBuffer>()
        for (entry in result) {
          val tensor = entry.value as OnnxTensor
          if (tensor.info.type != OnnxJavaType.FLOAT) throw IllegalStateException("Output type ${tensor.info.type}")
          val data = tensor.floatBuffer
          val part = ByteBuffer.allocate(data.remaining() * 4).order(ByteOrder.LITTLE_ENDIAN)
          part.asFloatBuffer().put(data); parts.add(part)
          list.put(JSONObject().put("n", entry.key).put("t", "float32").put("d", JSONArray(tensor.info.shape.toList())).put("l", part.capacity()))
        }
        val headOut = list.toString().toByteArray()
        val out = ByteBuffer.allocate(4 + headOut.size + parts.sumOf { it.capacity() }).order(ByteOrder.LITTLE_ENDIAN)
        out.putInt(headOut.size).put(headOut)
        parts.forEach { out.put(it.array()) }
        out.array()
      }
    } finally { feeds.values.forEach { it.close() } }
  }

  /** Silero's chance of speech for every 512 samples of 16 kHz mono floats, each window seeing the 64 samples before it, as
   * Silero's own wrapper does. The sound is read as it arrives, so a long clip needs no more memory than a short one. */
  fun speech(url: String, sound: InputStream, bytes: Long): FloatArray = using(url) { session ->
    val input = DataInputStream(sound)
    val count = (bytes / (WINDOW * 4)).toInt()
    val raw = ByteArray(WINDOW * 4); val window = FloatArray(CONTEXT + WINDOW); val probs = FloatArray(count)
    var state = FloatArray(2 * 128)
    OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(16000)), longArrayOf()).use { rate ->
      for (k in 0 until count) {
        input.readFully(raw)
        System.arraycopy(window, WINDOW, window, 0, CONTEXT)   // the end of the last window comes first
        ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(window, CONTEXT, WINDOW)
        OnnxTensor.createTensor(env, FloatBuffer.wrap(window), longArrayOf(1, (CONTEXT + WINDOW).toLong())).use { samples ->
          OnnxTensor.createTensor(env, FloatBuffer.wrap(state), longArrayOf(2, 1, 128)).use { memory ->
            session.run(mapOf("input" to samples, "state" to memory, "sr" to rate)).use { o ->
              probs[k] = (o.get("output").get() as OnnxTensor).floatBuffer.get(0)
              val next = (o.get("stateN").get() as OnnxTensor).floatBuffer
              state = FloatArray(next.remaining()).also { next.get(it) }
            }
          }
        }
      }
    }
    probs
  }

  private companion object {
    const val SMALL = 5L * 1024 * 1024
    const val MAX_OPEN = 60L * 1024 * 1024   // the beat tracker with the small models
    const val WINDOW = 512
    const val CONTEXT = 64
  }
}
