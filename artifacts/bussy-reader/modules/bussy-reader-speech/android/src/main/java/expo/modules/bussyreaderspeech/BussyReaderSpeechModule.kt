package expo.modules.bussyreaderspeech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BussyReaderSpeechModule : Module() {
  private var eventReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("BussyReaderSpeech")

    Events("speechStarted", "speechBoundary", "speechDone", "speechStopped", "speechError", "speechServiceLost")

    OnCreate {
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          val event = Bundle().apply {
            putString("id", intent.getStringExtra(ReadAloudService.EXTRA_UTTERANCE_ID))
            intent.getStringExtra(ReadAloudService.EXTRA_MESSAGE)?.let {
              putString("message", it)
            }
            if (intent.hasExtra(ReadAloudService.EXTRA_CHAR_INDEX)) {
              putInt("charIndex", intent.getIntExtra(ReadAloudService.EXTRA_CHAR_INDEX, 0))
            }
            if (intent.hasExtra(ReadAloudService.EXTRA_CHAR_LENGTH)) {
              putInt("charLength", intent.getIntExtra(ReadAloudService.EXTRA_CHAR_LENGTH, 0))
            }
          }
          when (intent.action) {
            ReadAloudService.ACTION_EVENT_STARTED -> sendEvent("speechStarted", event)
            ReadAloudService.ACTION_EVENT_BOUNDARY -> sendEvent("speechBoundary", event)
            ReadAloudService.ACTION_EVENT_DONE -> sendEvent("speechDone", event)
            ReadAloudService.ACTION_EVENT_STOPPED -> sendEvent("speechStopped", event)
            ReadAloudService.ACTION_EVENT_ERROR -> sendEvent("speechError", event)
            ReadAloudService.ACTION_EVENT_SERVICE_LOST -> sendEvent("speechServiceLost", event)
          }
        }
      }
      eventReceiver = receiver
      val filter = IntentFilter().apply {
        addAction(ReadAloudService.ACTION_EVENT_STARTED)
        addAction(ReadAloudService.ACTION_EVENT_BOUNDARY)
        addAction(ReadAloudService.ACTION_EVENT_DONE)
        addAction(ReadAloudService.ACTION_EVENT_STOPPED)
        addAction(ReadAloudService.ACTION_EVENT_ERROR)
        addAction(ReadAloudService.ACTION_EVENT_SERVICE_LOST)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        appContext.reactContext?.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        appContext.reactContext?.registerReceiver(receiver, filter)
      }
    }

    OnDestroy {
      eventReceiver?.let { receiver ->
        try {
          appContext.reactContext?.unregisterReceiver(receiver)
        } catch (_: IllegalArgumentException) {
          // The host may already have destroyed the receiver during teardown.
        }
      }
      eventReceiver = null
      ReadAloudService.stop(appContext.reactContext)
    }

    AsyncFunction("speak") { text: String, rate: Double, utteranceId: String ->
      ReadAloudService.speak(appContext.reactContext, text, rate.toFloat(), utteranceId)
    }

    AsyncFunction("stop") {
      ReadAloudService.stop(appContext.reactContext)
    }
  }
}
