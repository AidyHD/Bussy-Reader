package expo.modules.bussyreaderspeech

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.AudioAttributes
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.Locale

class ReadAloudService : Service() {
  private var textToSpeech: TextToSpeech? = null
  private var pendingRequest: SpeechRequest? = null
  private var activeRequest: SpeechRequest? = null
  private var ttsReady = false

  override fun onCreate() {
    super.onCreate()
    stopRequested = false
    try {
      createNotificationChannel()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          buildNotification(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        )
      } else {
        startForeground(NOTIFICATION_ID, buildNotification())
      }
    } catch (error: Throwable) {
      emit(
        ACTION_EVENT_ERROR,
        pendingRequest?.utteranceId.orEmpty(),
        "Android could not start the Read Aloud service: ${error.message ?: "unknown error"}"
      )
      stopSelf()
      return
    }

    try {
      textToSpeech = TextToSpeech(this) { status ->
        // TextToSpeech may call its listener before the constructor assignment
        // has returned. Always configure it on the main queue so the service
        // field is populated before we consume the callback.
        Handler(Looper.getMainLooper()).post {
          handleTtsInitialized(status)
        }
      }
    } catch (error: Throwable) {
      emit(
        ACTION_EVENT_ERROR,
        pendingRequest?.utteranceId.orEmpty(),
        "Android TextToSpeech could not initialize: ${error.message ?: "unknown error"}"
      )
      pendingRequest = null
      stopSelf()
    }
  }

  private fun handleTtsInitialized(status: Int) {
    try {
      if (status == TextToSpeech.SUCCESS) {
        val tts = textToSpeech ?: return
        try {
          tts.setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          val languageStatus = tts.setLanguage(Locale.getDefault())
          if (
            languageStatus == TextToSpeech.LANG_MISSING_DATA
            || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED
          ) {
            ttsReady = false
            pendingRequest?.let {
              emit(ACTION_EVENT_ERROR, it.utteranceId, "No installed Android voice supports this language.")
              pendingRequest = null
            }
            stopSelf()
            return
          }
        } catch (error: Throwable) {
          ttsReady = false
          pendingRequest?.let {
            emit(ACTION_EVENT_ERROR, it.utteranceId, "Android TextToSpeech could not configure a voice.")
            pendingRequest = null
          }
          stopSelf()
          return
        }
        ttsReady = true
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String) {
            emit(ACTION_EVENT_STARTED, utteranceId)
          }

          override fun onRangeStart(utteranceId: String, start: Int, end: Int, frame: Int) {
            if (activeRequest?.utteranceId != utteranceId) return
            emit(
              ACTION_EVENT_BOUNDARY,
              utteranceId,
              charIndex = start,
              charLength = (end - start).coerceAtLeast(0)
            )
          }

          override fun onDone(utteranceId: String) {
            if (activeRequest?.utteranceId == utteranceId) activeRequest = null
            emit(ACTION_EVENT_DONE, utteranceId)
          }

          override fun onError(utteranceId: String) {
            if (activeRequest?.utteranceId == utteranceId) activeRequest = null
            emit(ACTION_EVENT_ERROR, utteranceId, "Android TextToSpeech reported an error.")
          }

          override fun onStop(utteranceId: String, interrupted: Boolean) {
            emit(ACTION_EVENT_STOPPED, utteranceId)
          }
        })
        pendingRequest?.let {
          pendingRequest = null
          speakNow(it)
        }
      } else {
        ttsReady = false
        pendingRequest?.let {
          emit(ACTION_EVENT_ERROR, it.utteranceId, "Android TextToSpeech could not initialize.")
          pendingRequest = null
        }
        stopSelf()
      }
    } catch (error: Throwable) {
      emit(
        ACTION_EVENT_ERROR,
        pendingRequest?.utteranceId.orEmpty(),
        "Android TextToSpeech could not initialize: ${error.message ?: "unknown error"}"
      )
      pendingRequest = null
      stopSelf()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_SPEAK -> {
        stopRequested = false
        val request = SpeechRequest(
          text = intent.getStringExtra(EXTRA_TEXT).orEmpty(),
          rate = intent.getFloatExtra(EXTRA_RATE, 1.0f),
          utteranceId = intent.getStringExtra(EXTRA_UTTERANCE_ID).orEmpty()
        )
        if (request.text.isBlank() || request.utteranceId.isBlank()) {
          emit(ACTION_EVENT_ERROR, request.utteranceId, "Speech text was empty.")
        } else if (ttsReady) {
          speakNow(request)
        } else {
          pendingRequest = request
        }
      }
      ACTION_STOP -> {
        stopRequested = true
        activeRequest = null
        pendingRequest = null
        textToSpeech?.stop()
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  private fun speakNow(request: SpeechRequest) {
    val tts = textToSpeech ?: run {
      pendingRequest = request
      return
    }
    activeRequest = request
    tts.setSpeechRate(request.rate.coerceIn(0.1f, 4.0f))
    val result = try {
      tts.speak(
        request.text,
        TextToSpeech.QUEUE_FLUSH,
        Bundle().apply {
          // KEY_PARAM_STREAM expects the numeric Android stream type, not the
          // symbolic constant name. Passing "STREAM_MUSIC" can cause the TTS
          // engine to reject the utterance without producing audio.
          putString(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC.toString())
        },
        request.utteranceId
      )
    } catch (error: Throwable) {
      TextToSpeech.ERROR
    }
    if (result == TextToSpeech.ERROR) {
      if (activeRequest?.utteranceId == request.utteranceId) activeRequest = null
      emit(ACTION_EVENT_ERROR, request.utteranceId, "Android TextToSpeech rejected this page.")
    }
  }

  private fun emit(
    action: String,
    utteranceId: String,
    message: String? = null,
    charIndex: Int? = null,
    charLength: Int? = null
  ) {
    sendBroadcast(Intent(action).apply {
      setPackage(packageName)
      putExtra(EXTRA_UTTERANCE_ID, utteranceId)
      message?.let { putExtra(EXTRA_MESSAGE, it) }
      charIndex?.let { putExtra(EXTRA_CHAR_INDEX, it) }
      charLength?.let { putExtra(EXTRA_CHAR_LENGTH, it) }
    })
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Read Aloud",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Keeps Read Aloud active while the screen is locked."
        setShowBadge(false)
      }
    )
  }

  private fun buildNotification(): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle("Read Aloud")
      .setContentText("Reading your local document")
      .setOngoing(true)
      .setSilent(true)
      .apply { contentIntent?.let(::setContentIntent) }
      .build()
  }

  override fun onDestroy() {
    activeRequest?.let { request ->
      if (!stopRequested) {
        emit(
          ACTION_EVENT_SERVICE_LOST,
          request.utteranceId,
          "Android speech service stopped unexpectedly."
        )
      }
    }
    ttsReady = false
    textToSpeech?.stop()
    textToSpeech?.shutdown()
    textToSpeech = null
    pendingRequest = null
    activeRequest = null
    stopRequested = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private data class SpeechRequest(
    val text: String,
    val rate: Float,
    val utteranceId: String
  )

  companion object {
    const val ACTION_SPEAK = "com.bussyreader.app.READ_ALOUD_SPEAK"
    const val ACTION_STOP = "com.bussyreader.app.READ_ALOUD_STOP"
    const val ACTION_EVENT_STARTED = "com.bussyreader.app.READ_ALOUD_STARTED"
    const val ACTION_EVENT_BOUNDARY = "com.bussyreader.app.READ_ALOUD_BOUNDARY"
    const val ACTION_EVENT_DONE = "com.bussyreader.app.READ_ALOUD_DONE"
    const val ACTION_EVENT_STOPPED = "com.bussyreader.app.READ_ALOUD_STOPPED"
    const val ACTION_EVENT_ERROR = "com.bussyreader.app.READ_ALOUD_ERROR"
    const val ACTION_EVENT_SERVICE_LOST = "com.bussyreader.app.READ_ALOUD_SERVICE_LOST"
    const val EXTRA_TEXT = "text"
    const val EXTRA_RATE = "rate"
    const val EXTRA_UTTERANCE_ID = "utteranceId"
    const val EXTRA_MESSAGE = "message"
    const val EXTRA_CHAR_INDEX = "charIndex"
    const val EXTRA_CHAR_LENGTH = "charLength"
    private const val CHANNEL_ID = "bussy-reader-read-aloud"
    private const val NOTIFICATION_ID = 4101
    @Volatile
    private var stopRequested = false

    fun speak(context: Context?, text: String, rate: Float, utteranceId: String) {
      context ?: return
      val intent = Intent(context, ReadAloudService::class.java).apply {
        action = ACTION_SPEAK
        putExtra(EXTRA_TEXT, text)
        putExtra(EXTRA_RATE, rate)
        putExtra(EXTRA_UTTERANCE_ID, utteranceId)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context?) {
      context ?: return
      stopRequested = true
      context.stopService(Intent(context, ReadAloudService::class.java))
    }
  }
}