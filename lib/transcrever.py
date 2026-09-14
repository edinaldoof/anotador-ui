"""Worker local limitado: nenhum download ou envio de áudio durante a transcrição."""
import argparse
import json
import os
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["OMP_NUM_THREADS"] = "8"

MAX_SEGUNDOS = 120
TAXA = 16000
IDIOMAS = ["pt", "en", "es", "fr", "de", "it", "ja", "zh", "auto"]
modelos_carregados = {}


def decodificar(caminho, formato):
    import av
    import numpy as np
    formatos = {"webm": "matroska", "ogg": "ogg", "mp4": "mov", "wav": "wav"}
    partes = []
    amostras = 0
    with open(caminho, "rb") as arquivo:
        with av.open(arquivo, format=formatos[formato], options={"protocol_whitelist": "pipe"}) as recipiente:
            if not recipiente.streams.audio:
                raise ValueError("AUDIO_INVALIDO")
            fluxo = recipiente.streams.audio[0]
            fluxo.thread_type = "SLICE"
            fluxo.codec_context.thread_count = 1
            if fluxo.duration is not None and fluxo.time_base and float(fluxo.duration * fluxo.time_base) > MAX_SEGUNDOS:
                raise ValueError("DURACAO_EXCEDIDA")
            conversor = av.AudioResampler(format="fltp", layout="mono", rate=TAXA)
            for frame in recipiente.decode(fluxo):
                if frame.sample_rate > 192000 or len(frame.layout.channels) > 8:
                    raise ValueError("AUDIO_INVALIDO")
                for trecho in conversor.resample(frame):
                    dados = trecho.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                    amostras += dados.size
                    if amostras > MAX_SEGUNDOS * TAXA:
                        raise ValueError("DURACAO_EXCEDIDA")
                    partes.append(dados)
            for trecho in conversor.resample(None):
                dados = trecho.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                amostras += dados.size
                if amostras > MAX_SEGUNDOS * TAXA:
                    raise ValueError("DURACAO_EXCEDIDA")
                partes.append(dados)
    if not partes:
        raise ValueError("AUDIO_INVALIDO")
    audio = np.concatenate(partes)
    if not np.all(np.isfinite(audio)):
        raise ValueError("AUDIO_INVALIDO")
    return audio


def carregar_modelo(caminho):
    if caminho not in modelos_carregados:
        from faster_whisper import WhisperModel
        modelos_carregados[caminho] = WhisperModel(caminho, device="cpu", compute_type="int8", cpu_threads=8, num_workers=1, local_files_only=True)
    return modelos_carregados[caminho]


def transcrever(caminho, formato, idioma, caminho_modelo):
    import numpy as np
    if idioma not in IDIOMAS:
        raise ValueError("IDIOMA_INVALIDO")
    audio = decodificar(caminho, formato)
    duracao = len(audio) / TAXA
    # Silêncio digital não é fala: evita alucinar uma frase na gravação vazia.
    if float(np.max(np.abs(audio))) < 1e-5:
        return {"texto": "", "duracaoSegundos": duracao}
    modelo = carregar_modelo(caminho_modelo)
    segmentos, _ = modelo.transcribe(audio, language=None if idioma == "auto" else idioma, task="transcribe", beam_size=1, vad_filter=True,
                                    vad_parameters={"min_silence_duration_ms": 500}, condition_on_previous_text=False)
    texto = ""
    for segmento in segmentos:
        texto += (" " if texto else "") + segmento.text.strip()
        if len(texto) > 16000:
            texto = texto[:16000]
            break
    return {"texto": texto.strip(), "duracaoSegundos": duracao}


def executar_pedido(caminho, formato, idioma, modelo):
    try:
        return transcrever(caminho, formato, idioma, modelo)
    except Exception as erro:
        codigo = "DURACAO_EXCEDIDA" if str(erro) == "DURACAO_EXCEDIDA" else "AUDIO_INVALIDO"
        return {"erro": codigo}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--modelo", required=True)
    parser.add_argument("--audio")
    parser.add_argument("--formato", choices=["webm", "ogg", "mp4", "wav"])
    parser.add_argument("--idioma", choices=IDIOMAS, default="pt")
    parser.add_argument("--servir", action="store_true")
    args = parser.parse_args()
    if args.servir:
        # Uma mesma instância atende várias gravações. EOF encerra o worker se
        # o servidor morrer, sem manter subprocessos órfãos nem reter áudios.
        for linha in sys.stdin:
            if len(linha) > 8192:
                raise ValueError("PEDIDO_INVALIDO")
            pedido = json.loads(linha)
            if pedido.get("aquecer") is True:
                carregar_modelo(args.modelo)
                resultado = {"texto": "", "duracaoSegundos": 0}
            else:
                resultado = executar_pedido(pedido["audio"], pedido["formato"], pedido.get("idioma", "pt"), args.modelo)
            print(json.dumps(resultado, ensure_ascii=False), flush=True)
    else:
        resultado = executar_pedido(args.audio, args.formato, args.idioma, args.modelo)
        print(json.dumps(resultado, ensure_ascii=False), flush=True)
        if "erro" in resultado:
            sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except Exception as erro:
        codigo = "DURACAO_EXCEDIDA" if str(erro) == "DURACAO_EXCEDIDA" else "AUDIO_INVALIDO"
        print(json.dumps({"erro": codigo}))
        sys.exit(2)
