# Entrega dos resultados e reprodução

A falha confirmada no código anterior era a aplicação conjunta de todos os resultados: o cliente só atualizava o mixer, as cifras e as notas depois de baixar e decodificar todos os WAVs. Uma única falha ocultava os demais resultados. A captura fornecida não permite distinguir uma falha de rede de uma falha do decodificador; agora a interface informa o arquivo e o erro disponível.

A implementação mantém o guitarrock e sua notação SVG. A reprodução AAC em cache foi adaptada do mecanismo técnico de `app/faixalab/backing.py` do [FaixaLab, revisão 0a74a79](https://github.com/Marcelo-Preigschadt/FaixaLab/tree/0a74a79). Os modelos de separação e transcrição não foram substituídos nesta correção.

## Verificações executadas

- 28 testes Python: autenticação, fila, isolamento de arquivos, cancelamento, recuperação, codificação AAC real, cache, HTTP Range e preservação do manifesto quando um WAV está ausente.
- 22 testes TypeScript: aplicação das notas antes dos downloads, falha parcial, reutilização do cache, preservação de edições, cancelamento por troca de sessão, erros HTTP/HTML e reprodução de mídia sem alocação de AudioBuffers PCM.
- Compilação TypeScript e build de produção.
- Navegador com separação e transcrição reais de uma amostra sintetizada de cinco segundos. Após a conclusão, uma pista foi temporariamente retirada para provocar HTTP 404: as outras cinco pistas e a notação permaneceram disponíveis. Restaurar o arquivo e usar a recuperação concluiu o mesmo resultado, sem novo processamento pela IA. A reprodução foi iniciada e o relógio avançou.
- Navegador com seis arquivos AAC de 270 segundos: carregamento, reprodução, pausa, mute e avanço para cerca de 2min28s, com acompanhamento dos compassos. Esse projeto de teste repete stems da amostra curta; valida a entrega e a reprodução longa, não a precisão da transcrição em uma música comercial de 4min30s.

Não houve acesso ao áudio original da captura do usuário nem ao diagnóstico específico de sua falha de download. O botão **Recuperar resultado** permite buscar a tarefa concluída no mesmo Codespace, mantendo as faixas recebidas e as correções locais.

## Fontes consultadas

- [MDN — AudioBuffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer): o áudio decodificado reside na memória; mídia é apropriada para fontes longas.
- [MDN — decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData): a decodificação depende do arquivo completo.
- [FastAPI — FileResponse](https://fastapi.tiangolo.com/advanced/custom-response/#fileresponse): transmissão do arquivo e cabeçalhos de resposta.
- [GitHub — segurança do Codespaces](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces): autenticação das portas privadas. Essa documentação justifica reconhecer respostas HTML de autenticação; não comprova que essa foi a causa da falha relatada.

## Versão 0.3.0 — letra automática e transferências interrompidas

A nova captura de 25/11 mostra seis stems no manifesto, três recebidos e `Failed to fetch` em voz, bateria e outros. Isso comprova que a separação terminou nesse caso, mas não identifica, isoladamente, a causa de rede no Codespace. A captura anterior mostrava uma interface ainda mais antiga. A versão passa a ser visível como **v0.3.0**, com revisão e hash de fontes no build.

- O download usa intervalos HTTP Range de até 1 MiB, com duas tentativas por intervalo. Trechos recebidos ficam em memória para a recuperação na mesma aba; arquivos completos continuam salvos no projeto local. Recarregar a página perde os trechos parciais, preservando os áudios completos. `If-Range` e ETag evitam misturar revisões de arquivos. O WAV original continua sendo a opção de download; o mixer recebe AAC.
- Um teste provoca `Failed to fetch` na leitura do segundo intervalo depois de receber o primeiro MiB: a recuperação solicita apenas o intervalo pendente. Autorização/HTML de login continuam tendo diagnóstico próprio.
- Faster-whisper usa Whisper small CPU/int8, voz isolada, detecção automática do idioma e timestamps por palavra. A fila da letra mantém a tarefa de áudio concluída; cancelamento, repetição e recuperação de worker não removem os stems.
- A cifra usa um mix de guitarra, piano e outros; o peso de outros é menor quando há stems harmônicos dedicados. O estimador continua restrito a tríades maiores/menores.
- Execução real no navegador: upload de MP3 original de seis segundos, com voz sintetizada por FFmpeg/flite, tons de Em/C e percussão; Demucs gerou seis WAVs distintos, Basic Pitch gerou eventos, o estimador marcou Em, e Whisper reconheceu a frase “The guitar plays in the morning, we sing together through the night.” na voz separada. Mixer com seis stems e original silenciado, mute de guitarra, reprodução e destaque por palavra foram observados. A letra foi solicitada novamente sobre a mesma tarefa.
- 35 testes Python e 27 testes TypeScript, compilação de produção e execução real do script de reinício. O reinício confirmou API/worker/ASR, manifesto de versão e igualdade do HTML servido com o build local.

Essa amostra valida a integração. Não foi possível acessar o áudio de 4min30s do usuário ou sua sessão autenticada do Codespace para confirmar a recuperação específica naquele servidor. A precisão da letra cantada, dos acordes e da tablatura em músicas reais não é comprovada pelo teste com fala sintetizada.

Referências: [faster-whisper](https://github.com/SYSTRAN/faster-whisper) e a implementação `app/faixalab/pipeline.py` do [FaixaLab](https://github.com/Marcelo-Preigschadt/FaixaLab), revisão do arquivo `3d63002127460416d187a867632df59fe9f7e655`. Foi reaproveitada a configuração técnica de ASR, mantendo o aplicativo guitarrock.

## Versão 0.3.1 — cifra no braço, recuperação harmônica e revisões

- A aba inicial **Cifra e braço** mostra um diagrama de acorde, notas nas cordas/casas e a sequência reconhecida. O braço alterna entre digitação sugerida do acorde e notas estimadas de guitarra/baixo. As posições não identificam a digitação original do músico.
- As digitações foram verificadas por classes de altura: 12 fundamentais e 10 qualidades produzem exatamente as notas do acorde. O detector de áudio continua cobrindo tríades maiores/menores; o dicionário visual também aceita acordes digitados manualmente, como sétimas e power chords.
- A cifra passa a ter dados próprios (`Project.harmony`). Importar letra não a apaga. Marcadores antigos com acordes simples também podem alimentar a visualização. Recalcular cifra usa os WAVs existentes, sem Demucs nem nova transcrição de notas.
- O gate de energia harmônica deixou de usar um limiar absoluto de .003, que descartava acompanhamento baixo. Usa nível relativo e inclui o baixo com peso reduzido. Um teste com Em/C mantém os mesmos acordes após redução de amplitude em 60 dB. A amostra de seis segundos, após separação, retornou Em até 3.04 s e C em seguida.
- Refinamento executado de verdade com os especialistas oficiais `04573f0d` (voz) e `f7e0c4bc` (bateria), sete segundos de contexto e 50% de sobreposição. A comparação SHA-256 confirmou preservação dos quatro outros WAVs e de todos os WAVs da tarefa anterior. A interface conserva uma cópia local anterior para comparação. Isso valida a execução e preservação, não uma melhoria perceptiva universal.
- Whisper large-v3-turbo CPU/int8 executado no MP3 original da amostra, com idioma inglês fixado, reconhecendo a frase de teste e timestamps. A interface permite escolher o idioma e refazer a letra no original; remove a letra anterior enquanto aguarda. Trechos com baixa confiança ficam sem palavras e são marcados para revisão. Confiança do modelo não comprova que a letra está correta.
- Navegador: resultado de IA salvo, recálculo de cifra sem separação, troca Em→C com atualização do diagrama e do braço, modo notas da faixa e seleção de idioma/refazer letra.

Não houve acesso ao áudio do usuário nesta rodada. A amostra contém fala sintetizada e instrumentos gerados para teste; não comprova a qualidade da voz cantada na música do usuário. O refinamento é opcional, adiciona duas inferências e não usa uma API paga.

Fonte dos especialistas: [configuração oficial de htdemucs_ft](https://github.com/facebookresearch/demucs/blob/main/demucs/remote/htdemucs_ft.yaml). O modo comum passa a usar janela de sete segundos e overlap de 50%; o conjunto de seis fontes continua experimental.

Validação final da versão 0.3.1: 40 testes Python, 32 testes TypeScript e build de produção aprovados.
