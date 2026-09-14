#!/usr/bin/env bash
# Instalação explícita; requisições de transcrição nunca baixam dependências.
set -euo pipefail
anotador_voz_dir="$HOME/.local/share/anotador-ui/voz"
anotador_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
umask 077
mkdir -p "$anotador_voz_dir"
uv venv --allow-existing --python 3.12 "$anotador_voz_dir/venv"
uv pip install --python "$anotador_voz_dir/venv/bin/python" -r "$anotador_script_dir/voz-requirements.txt"
"$anotador_voz_dir/venv/bin/python" - <<'PY'
from pathlib import Path
from huggingface_hub import snapshot_download
pasta = Path.home() / '.local/share/anotador-ui/voz'
revisao = '536b0662742c02347bc0e980a01041f333bce120'
snapshot_download('Systran/faster-whisper-small', revision=revisao,
                  local_dir=str(pasta / 'modelo'),
                  allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.*'])
(pasta / 'modelo-revisao.txt').write_text(revisao + '\n')
print('Transcrição local instalada. O áudio permanece no servidor do anotador.')
PY
