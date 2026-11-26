# RiffSync

**Sua música. Seu jeito de tocar.**

Estúdio web para carregar uma gravação, separar instrumentos e gerar automaticamente um arranjo em compassos, pautas, cifras e tablaturas, sincronizado com as pistas de áudio reais. Interface em português, compatível com computador e celular.

## Funcionalidades implementadas

- Importação local de MP3, WAV, FLAC, OGG, M4A, AAC, WebM e Opus, conforme os codecs do navegador. WebM pode conter vídeo: o processamento extrai sua pista de áudio automaticamente.
- Reprodução multifaixa com controle de volume, mute e solo por pista. Trechos curtos usam buffers Web Audio; projetos longos usam elementos de mídia com relógio de uma pista de referência e correção de desvio, evitando carregar todas as pistas como PCM na memória.
- Reprodução em M4A/AAC a 320 kbps, preparada uma vez e guardada no servidor, adaptando o mecanismo técnico do FaixaLab. Os WAVs separados permanecem intactos para download pelo botão de cada pista. O original enviado não é alterado.
- Entrega incremental: cifras, notas, tablaturas e compassos aparecem assim que o manifesto está pronto. Cada pista tem estado de carregamento próprio. Uma falha não oculta as demais nem remove as correções já feitas.
- Controle de visibilidade da notação independente do mute do áudio.
- Forma de onda com posição de reprodução, marcadores arrastáveis e repetição A–B.
- Importação de texto TXT, LRC e ChordPro; espaços de cifras e tablaturas ASCII são preservados. LRC mantém os timestamps.
- Sincronização manual por bloco ou linha: selecione o trecho, toque o áudio e pressione **M**, ou use **Marcar**. Tempos também podem ser digitados.
- **Cifra e braço**: sequência de acordes com diagramas, braço horizontal e notas nas casas sincronizadas. Alterna digitação sugerida do acorde e notas detectadas na guitarra/baixo. A cifra é armazenada separadamente do texto importado. **Gerar/Recalcular cifra** reutiliza as faixas existentes e não executa Demucs.
- **Refinar voz e bateria**: aplica somente os especialistas `04573f0d` (voz) e `f7e0c4bc` (bateria) do conjunto oficial `htdemucs_ft`, em duas passagens. Baixo, guitarra, piano e outros são preservados byte a byte; o resultado anterior permanece no servidor e é salvo como projeto local para comparação. Não garante uma melhoria perceptível em toda música e acrescenta tempo de inferência.
- **Arranjo da IA**: pautas e tablaturas geradas diretamente dos eventos de notas detectados, com cifras acima dos compassos, cursor e páginas acompanhando a reprodução. Não exige importação de Guitar Pro/MusicXML e não gera arquivos MIDI.
- Edição visual de cada nota: início, fim, corda, casa ou altura. A grade visual pode ser ajustada por BPM e compasso. A reprodução usa os WAVs separados, preservando o timbre da gravação.
- Marcação de ataques de bateria, melodia da voz e notas de piano. O andamento, a métrica e as digitações são estimativas editáveis.
- Separação real com Demucs: modelos `htdemucs` (4 pistas), `htdemucs_ft` (4 pistas, refinado) e `htdemucs_6s` (6 pistas, experimental).
- Início direto por **Separar com IA** no mixer ou **Separar instrumentos** nas configurações. Com API e worker no mesmo servidor do aplicativo, o endereço pode ficar vazio. Erros de envio permanecem visíveis na tela com a resposta do servidor.
- Transcrição de notas por stem com Basic Pitch; estimativa de cordas e casas para guitarra e baixo em afinação padrão. Piano mantém eventos de notas no projeto.
- Estimativa de acordes maiores/menores por chroma, segmentação rítmica e suavização temporal. O limite de silêncio considera o nível do acompanhamento separado, para não eliminar acordes apenas por estarem baixos. Trechos sem evidência suficiente não recebem um acorde inventado.
- Letra automática com faster-whisper/Whisper `large-v3-turbo`, CPU `int8`, idioma automático e timestamps por palavra, usando o áudio original para evitar depender de uma voz isolada com artefatos. A aba **Letra e cifra** acompanha a reprodução e permite corrigir texto e tempos. O processamento da letra começa depois da entrega do resultado musical e não bloqueia os áudios concluídos.
- O botão **Gerar letra com IA** reutiliza a voz de uma tarefa concluída. Cancelar ou repetir a letra preserva as faixas, cifras, notas e controles do mixer. O worker persiste e recupera essa fila separadamente. Letras editadas não são sobrescritas por consultas repetidas da mesma revisão.
- Cifras estimadas no acompanhamento separado (`guitar`, `piano`, `other`, com apoio do `bass`), com menor peso para `other` quando há instrumentos harmônicos dedicados; a voz e a bateria não entram nesse mix. A aba **Acordes** permite corrigir as estimativas.
- Fila SQLite persistente, worker separado da API, progresso por etapa, cancelamento e detecção de worker interrompido.
- Uma retentativa automática se um subprocesso receber SIGTERM com o worker ainda ativo. Reiniciar o worker recoloca a tarefa na fila; cancelamentos explícitos são preservados. O botão **Retomar processamento** reutiliza o upload de tarefas que falharam.
- Separação com janelas de 7 segundos e sobreposição de 50% por padrão, retentativa automática com janelas menores quando há falta de memória e diagnóstico copiável na tela para falhas de memória, rede/modelos, dependências e disco. As janelas não limitam a duração da música.
- Transcrição ONNX em blocos de até 32 segundos com contexto e fusão de eventos nas fronteiras, para limitar o uso de memória.
- Acesso às tarefas e arquivos restrito à chave aleatória da sessão do navegador.
- Projetos locais persistidos no IndexedDB, exportação/importação de `.riffsync` com áudios e partitura, download das pistas e exportação do acompanhamento em WAV.
- Cache offline do aplicativo após um carregamento completo da versão de produção. A IA exige o servidor; sessões já baixadas podem ser estudadas localmente.
- Demonstração de 19 segundos com arranjo original sintetizado. **A demonstração é identificada como tal e não simula resultados de IA.**

## Executar com Docker

Requer Docker com Compose. A imagem usa Python 3.11, FFmpeg e PyTorch para CPU.

```bash
docker compose up --build
```

Abra **http://localhost:8000**. O mesmo endereço serve o aplicativo e a API. O segundo serviço executa o worker; ambos compartilham os arquivos e a fila. Os pesos do Demucs são baixados no primeiro processamento e permanecem no volume `riffsync-models`. A API permanece responsiva durante o processamento.

O build instala dependências de IA grandes. O tempo de separação depende de CPU/GPU, duração da música e modelo escolhido; o aplicativo não promete um prazo fixo. Para GPU NVIDIA, instale wheels CUDA compatíveis de `torch` e `torchaudio` juntos, disponibilize a GPU ao container e defina `RIFFSYNC_DEVICE=cuda`. A imagem fornecida usa CPU.

## Abrir no GitHub Codespaces

Use **Code → Codespaces → Create codespace on main**. A configuração em `.devcontainer` instala as dependências e inicia API e worker. Abra a porta **8000**, identificada como **RiffSync Studio**. O primeiro preparo pode levar alguns minutos. Codespaces pausa quando a sessão é encerrada ou fica inativa; não é hospedagem permanente.

## Instalação local

Pré-requisitos: **Python 3.11**, **Node.js 22**, **FFmpeg** e `libsndfile`.

```bash
bash scripts/setup.sh
bash scripts/start.sh
```

Abra **http://localhost:8000**. Os scripts são para Linux/macOS ou WSL. No Windows, Docker Desktop é a alternativa para executar a configuração completa.

### Desenvolvimento

```bash
# Inicia API, worker e interface com atualização automática.
npm run dev
```

Acesse **http://localhost:5173**. O Vite encaminha `/api` para `localhost:8000`.
Sem `.venv`, esse comando inicia apenas a interface. Para executá-los separadamente, use `uvicorn riffsync.api:app --reload --port 8000`, `python -m riffsync.worker` e `npm --prefix frontend run dev` no ambiente Python instalado.

## Publicar a interface separadamente

O workflow manual **Publish web app to GitHub Pages** gera e publica `frontend/dist`. Antes de executá-lo, selecione **GitHub Actions** como origem em **Settings → Pages** do repositório. O build usa caminhos relativos e suporta o subdiretório `/guitarrock/`.

GitHub Pages hospeda a interface estática. Para usar IA, hospede a API **e o worker** em um servidor Python e informe sua URL em **Configurações → Endereço do servidor**. Inclua a origem exata do frontend em `CORS_ORIGINS`, por exemplo `https://SEU-USUARIO.github.io`, e use HTTPS quando a interface estiver em HTTPS. O servidor precisa ter acesso aos pesos dos modelos. Não há servidor de IA público contratado ou configurado neste repositório.

## Atualizar um Codespace existente

Na raiz do repositório:

```bash
git pull --ff-only && python3 scripts/restart.py
```

Esse comando instala o reconhecimento de letra se estiver ausente, recompila a interface, encerra somente os processos RiffSync deste checkout e inicia API e worker. Confere a versão do build no endpoint de saúde **e compara o HTML efetivamente servido com o build recém-criado**. A confirmação inclui versão, revisão e identificador de build. Após recarregar a aba, a barra lateral deve mostrar **v0.3.1**. O script de início também recompila quando a revisão ou os arquivos da interface mudaram, mesmo que já exista `dist/index.html`.

API e worker são iniciados em sessões independentes do terminal. Um bloqueio por diretório de dados impede dois workers simultâneos. Os uploads e projetos do diretório `data` são preservados. Não apague os dados do site no navegador: os projetos e a chave de acesso às tarefas são armazenados ali.

O Whisper baixa seus pesos no primeiro uso e os conserva em `data/models/whisper`. `LYRICS_MODEL` escolhe o modelo (padrão `large-v3-turbo`) e `LYRICS_LANGUAGE` pode fixar `pt`, `en` ou outro idioma aceito; vazio ativa detecção automática. Nenhuma chave de API paga é necessária. Canto, vazamentos da separação e ruído podem causar omissões ou palavras incorretas; o reconhecimento não consulta um catálogo de letras oficiais.

Para uma tarefa que já falhou, clique em **Retomar processamento**: o servidor reutiliza o arquivo enviado e reinicia o processamento, sem novo upload. Não há checkpoint dentro do modelo. Uma queda abrupta do worker permite até duas recuperações automáticas; interrupções repetidas exigem retomada manual. O código `−15` identifica SIGTERM, mas não informa quem enviou o sinal. Encerrar o Codespace também encerra seus processos.

Se uma tarefa falhar, abra **Ver diagnóstico do processamento → Copiar diagnóstico**. Tarefas antigas que falharam também exibem os logs quando ainda estão disponíveis no servidor. Não é necessário copiar o terminal.

Se a IA concluiu mas faltam áudios, use **Recuperar resultado**. Essa ação busca o resultado da mesma tarefa e reutiliza as pistas já recebidas; não envia a música novamente nem executa o separador. O erro indica o arquivo e a resposta HTTP quando disponíveis. A partitura e a cifra permanecem acessíveis durante a recuperação. Projetos parcialmente recebidos são salvos localmente e retomam a entrega ao serem reabertos.

## Configuração do backend

| Variável | Padrão | Finalidade |
|---|---|---|
| `RIFFSYNC_DATA` | `./data` | SQLite, uploads e resultados; deve ser compartilhado entre API e worker |
| `RIFFSYNC_DEVICE` | `auto` | `cpu`, `cuda` ou seleção automática |
| `SEPARATION_SEGMENT_SECONDS` | `7` | Janela interna do modelo, entre 1 e 7 segundos |
| `MAX_UPLOAD_MB` | `200` | Limite por upload no backend |
| `MAX_DURATION_SECONDS` | `1200` | Duração máxima do áudio enviado à IA |
| `JOB_TIMEOUT_SECONDS` | `7200` | Timeout por etapa de subprocesso |
| `RETENTION_DAYS` | `7` | Remove tarefas terminadas e seus arquivos após esse prazo; `0` desativa |
| `CORS_ORIGINS` | localhost nas portas 5173/8000 | Origens exatas autorizadas a chamar a API |
| `FRONTEND_DIST` | `./frontend/dist` | Diretório do frontend compilado, se servido pela API |

`.env.example` documenta as variáveis. O Compose lê `.env` para substituições, mas a execução direta do Python usa as variáveis exportadas no ambiente.

### API

Documentação interativa em `/docs`.

| Método | Endpoint | Uso |
|---|---|---|
| GET | `/api/health` | Disponibilidade da API, worker e modelos |
| POST | `/api/jobs` | Multipart `file`, `model`, `transcribe` |
| GET | `/api/jobs/{id}` | Estado, progresso, avisos e resultado |
| POST | `/api/jobs/{id}/cancel` | Interromper processamento |
| POST | `/api/jobs/{id}/retry` | Recolocar tarefa com falha na fila, reutilizando o upload |
| GET | `/api/jobs/{id}/files/{filename}` | Baixar uma pista finalizada |
| GET | `/api/jobs/{id}/files/{filename}?format=m4a` | Reprodução AAC em cache, com a mesma autenticação e suporte a HTTP Range |
| DELETE | `/api/jobs/{id}` | Remover tarefa finalizada com sucesso ou falha |

Exceto `/health`, as rotas requerem `X-Workspace-Key` com a chave gerada pelo frontend. A chave não é enviada em query strings. Isso isola sessões, mas não implementa cadastro, login Google, recuperação de conta ou quotas por pessoa. A fila limita tarefas ativas por sessão e globalmente. Para uma oferta pública multiusuário, acrescente autenticação e quotas de processamento antes da abertura.

## Estrutura

```text
frontend/src/          Interface React/TypeScript, áudio e sincronização
frontend/src/components/  Mixer, forma de onda, tablatura e partitura
backend/riffsync/      API, fila, worker e transcrição
backend/tests/         Testes de isolamento, fila, arquivos e cancelamento
scripts/               Instalação, inicialização e teste dos modelos reais
.github/workflows/     Validação contínua e publicação manual da interface
```

## Validação

```bash
npm ci --prefix frontend
npm test
npm run build
.venv/bin/python -m unittest discover -s backend/tests -v

# Executa Demucs e Basic Pitch reais; baixa os pesos se necessário.
.venv/bin/python scripts/smoke_pipeline.py

# Mesma integração com arquivos realmente codificados em WebM/Opus e MP3.
RIFFSYNC_SMOKE_FORMAT=webm .venv/bin/python scripts/smoke_pipeline.py
RIFFSYNC_SMOKE_FORMAT=mp3 .venv/bin/python scripts/smoke_pipeline.py
```

O teste de modelos usa uma gravação sintetizada de 5 segundos, passa pelo endpoint de upload, separa seis instrumentos, transcreve os stems e verifica o download dos seis WAVs. Ele valida a integração; não mede qualidade musical em gravações comerciais.

## Limites da transcrição

A separação não recupera perfeitamente os instrumentos originais; vazamentos e artefatos afetam as notas detectadas. O modelo de seis pistas não garante a separação entre guitarra solo e base, e sua saída de piano é experimental. Basic Pitch estima alturas e durações; cordas/casas são uma digitação possível, não uma identificação da execução original. Bends, slides, ligaduras e articulações não são reconstruídos nesta versão. O estimador de cifras atual cobre tríades maiores/menores, não um dicionário completo de acordes. Todo material gerado pode ser corrigido no editor de notas ou complementado por cifras e tablaturas TXT sincronizadas manualmente. A grade de compassos é estimada em 4/4 por padrão, podendo ser corrigida pelo usuário.

## Componentes utilizados

- [React](https://react.dev/) e [TypeScript](https://www.typescriptlang.org/)
- [Bravura](https://github.com/steinbergmedia/bravura) — fonte musical SMuFL, SIL OFL; distribuída pelo pacote alphaTab. A notação usa SVG próprio, sem o player MIDI do alphaTab.
- [Demucs](https://github.com/facebookresearch/demucs) — separação, MIT; repositório original arquivado
- [Basic Pitch](https://github.com/spotify/basic-pitch) — transcrição, Apache-2.0
- [librosa](https://librosa.org/) — análise de áudio, ISC
- [FastAPI](https://fastapi.tiangolo.com/) — API Python, MIT
- [Lucide](https://lucide.dev/) — ícones, ISC
- DM Sans e Manrope — fontes distribuídas com o frontend, SIL Open Font License

Na aba **Letra e cifra**, o idioma pode ser fixado em português, inglês ou espanhol. Refazer a letra usa o áudio original e descarta a transcrição anterior da tela enquanto processa. Trechos de baixa confiança ficam sem texto e são marcados para revisão; a confiança do modelo não comprova fidelidade à letra real.
