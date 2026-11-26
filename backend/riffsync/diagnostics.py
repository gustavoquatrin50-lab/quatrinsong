"""Bounded, useful subprocess errors instead of a generic processing failure."""
import re


def summarize_failure(returncode, detail):
    text = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", detail).replace("\r", "\n")
    lines = [line for line in text.splitlines() if line.strip() and not re.search(r"\d+%\|", line)]
    excerpt = "\n".join(lines[-16:])[-3500:]
    lower = excerpt.lower()
    if returncode in (-15, 143):
        return "terminated", "O processo recebeu SIGTERM (sinal 15) e foi interrompido externamente. O arquivo enviado foi preservado para retomar.", "Encerramento por SIGTERM (15).\n" + excerpt
    if returncode in (-9, 137) or any(p in lower for p in ("out of memory", "cannot allocate memory", "defaultcpuallocator", "std::bad_alloc")):
        return "memory", "O separador foi encerrado por falta de memória ou por um limite do servidor.", excerpt
    if any(p in lower for p in ("http error", "urlopen error", "certificate_verify_failed", "name resolution", "connection refused", "connection reset", "timed out")):
        return "model_download", "Não foi possível baixar ou carregar os pesos do modelo. Confira a conexão do servidor e tente novamente.", excerpt
    if any(p in lower for p in ("no space left", "disk quota exceeded")):
        return "disk", "O servidor ficou sem espaço para salvar as pistas de áudio.", excerpt
    if any(p in lower for p in ("modulenotfounderror", "importerror", "undefined symbol", "libtorch", "libcudart")):
        return "dependency", "Uma dependência de processamento não carregou. Os detalhes mostram qual biblioteca falhou.", excerpt
    if any(p in lower for p in ("could not load file", "invalid data found", "error opening input")):
        return "audio", "O separador não conseguiu ler o áudio enviado.", excerpt
    last_error = next((line.strip() for line in reversed(lines) if re.search(r"(?:Error|Exception|error):", line)), "")
    return "processing", f"O separador falhou (código {returncode})." + (f" {last_error[:250]}" if last_error else " Consulte os detalhes da tarefa."), excerpt
