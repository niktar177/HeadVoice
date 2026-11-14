import logging
import numpy as np
import sounddevice as sd


class AudioManager:
    # Класс-обёртка над InputStream. Считает RMS громкости с микрофона.
    def __init__(self, samplerate=44100, blocksize=1024):
        self.samplerate = samplerate
        self.blocksize = blocksize
        self.volume = 0.0
        self.stream = None
        self._audio_error_count = 0

    def start(self):
        # Идемпотентно: если стрим уже был, закрываем его и создаём заново.
        # Так чинится ситуация, когда микрофон отвалился (например, USB переподключили).
        self.stop()
        try:
            self.stream = sd.InputStream(
                samplerate=self.samplerate,
                channels=1,
                blocksize=self.blocksize,
                callback=self._audio_cb,
            )
            self.stream.start()
            logging.info("Audio stream started")
        except Exception as e:
            logging.error(f"Mic error: {e}")
            self.stream = None

    def stop(self):
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None

    def is_active(self):
        return self.stream is not None and self.stream.active

    def _audio_cb(self, indata, frames, time, status):
        # Колбэк из аудио-потока. Сюда лучше не лазить с тяжёлыми вычислениями.
        try:
            if status:
                # Статусы (xrun, overflow) летят часто — не спамим в лог
                self._audio_error_count += 1
                if self._audio_error_count % 100 == 0:
                    logging.warning(f"Audio status: {status}")
            # RMS — корень из среднего квадрата. Простой и рабочий индикатор громкости.
            rms = float(np.sqrt(np.mean(indata ** 2)))
            self.volume = rms
        except Exception as e:
            logging.error(f"Audio callback fatal: {e}")