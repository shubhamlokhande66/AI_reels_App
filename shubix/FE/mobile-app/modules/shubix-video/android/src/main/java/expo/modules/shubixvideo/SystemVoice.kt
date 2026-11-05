package expo.modules.shubixvideo

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Speech from the phone's own text-to-speech: nothing to download from us, and the words stay on the phone (only voices
 * that work offline are used). `language`: a tag such as hi-IN. One speech at a time. */
class SystemVoice(private val context: Context, private val dir: File) {
  private var engine: TextToSpeech? = null

  private fun ready(): TextToSpeech {
    engine?.let { return it }
    val up = CountDownLatch(1); var status = TextToSpeech.ERROR
    val made = TextToSpeech(context) { s -> status = s; up.countDown() }
    if (!up.await(20, TimeUnit.SECONDS) || status != TextToSpeech.SUCCESS) { made.shutdown(); throw IllegalStateException("This phone has no text-to-speech") }
    engine = made
    return made
  }

  private fun voiceFor(tts: TextToSpeech, language: String): Voice =
    tts.voices.orEmpty()
      .filter { it.locale.toLanguageTag().equals(language, true) && !it.isNetworkConnectionRequired && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features }
      .maxByOrNull { it.quality } ?: throw IllegalStateException("No voice for $language on this phone")

  /** Mono samples from -1 to 1, and their rate. */
  @Synchronized fun speak(text: String, language: String): Pair<FloatArray, Int> {
    val tts = ready()
    if (text.length > TextToSpeech.getMaxSpeechInputLength()) throw IllegalArgumentException("Too much text at once")
    tts.voice = voiceFor(tts, language)
    val file = File(dir.apply { mkdirs() }, "speech-${UUID.randomUUID()}.wav")
    val id = file.name
    val over = CountDownLatch(1); var failed = false
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utterance: String?) {}
      override fun onDone(utterance: String?) { if (utterance == id) over.countDown() }
      @Deprecated("Deprecated in Java") override fun onError(utterance: String?) { if (utterance == id) { failed = true; over.countDown() } }
      override fun onError(utterance: String?, errorCode: Int) { if (utterance == id) { failed = true; over.countDown() } }
    })
    try {
      if (tts.synthesizeToFile(text, Bundle(), file, id) != TextToSpeech.SUCCESS) throw IllegalStateException("The voice did not start")
      if (!over.await(120, TimeUnit.SECONDS) || failed) throw IllegalStateException("The voice did not finish")
      return readWav(file.readBytes())
    } finally { file.delete() }
  }

  fun close() { engine?.shutdown(); engine = null }

  /** 16-bit PCM in a WAV file, as mono floats (the channels are averaged). */
  private fun readWav(wav: ByteArray): Pair<FloatArray, Int> {
    val b = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
    var at = 12; var rate = 0; var channels = 0; var bits = 0
    while (at + 8 <= wav.size) {
      val name = String(wav, at, 4); val size = b.getInt(at + 4); val body = at + 8
      if (name == "fmt ") { channels = b.getShort(body + 2).toInt(); rate = b.getInt(body + 4); bits = b.getShort(body + 14).toInt() }
      if (name == "data") {
        if (bits != 16 || channels < 1 || rate <= 0) throw IllegalStateException("Unknown voice format")
        val length = minOf(if (size > 0) size else wav.size - body, wav.size - body) / 2 / channels
        return FloatArray(length) { i -> var sum = 0f; for (c in 0 until channels) sum += b.getShort(body + (i * channels + c) * 2); sum / channels / 32768f } to rate
      }
      at = body + size + (size and 1)
    }
    throw IllegalStateException("No sound in the voice's file")
  }
}
