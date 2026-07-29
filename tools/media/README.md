# Solforge media adapters (open-source)

Optional local backends for image / sound / speech. **Not** required for plan+preview.

| Adapter | Backend | Env |
|---------|---------|-----|
| image | AUTOMATIC1111 / ComfyUI HTTP API | `SOLFORGE_SD_URL` (default `http://127.0.0.1:7860`) |
| image-alt | Stable Diffusion WebUI forge | same |
| tts | Piper CLI | `SOLFORGE_PIPER_BIN`, `SOLFORGE_PIPER_VOICE` |
| stt | Whisper.cpp / faster-whisper | `SOLFORGE_WHISPER_BIN` |

Install examples (operator machine, optional):

```bash
# Piper (small TTS)
# https://github.com/rhasspy/piper/releases

# SD WebUI or ComfyUI separately if you want image gen

# Tabby is coding autocomplete — not media; see host install
```

CLI:

```bash
python3 tools/media/solforge_media.py status
python3 tools/media/solforge_media.py tts --text "hello" --out /tmp/out.wav
python3 tools/media/solforge_media.py image --prompt "clay mug studio" --out /tmp/mug.png
```
