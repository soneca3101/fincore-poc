# FinCore PoC

PoC de uma tela do FinCore com **React + FastAPI**, dados públicos da Binance e análise estruturada do Gemini. O Gemini substitui temporariamente a inferência da SLM para demonstrar o fluxo; não substitui nem valida o treinamento do Qwen3.

## O que funciona

- Consulta pública de preço, variação de 24 horas e candles da Binance Spot, sem chave de exchange.
- Cálculo determinístico de SMA 20, SMA 50, RSI 14, volatilidade e tendência.
- Uma chamada ao Gemini que retorna uma análise estruturada para os oito papéis: Market, Technical, Macro, Strategy, Risk, Portfolio, Execution e Supervisor.
- Painel React responsivo para desktop e celular, servido em desenvolvimento pelo Vite e pela FastAPI depois do build.
- Release Gate determinístico sempre bloqueado, com os requisitos de confiabilidade e consistência de 75% por agente.
- Kill Switch fora do modelo, para interromper novas análises estratégicas nesta sessão.

## Executar localmente

Requisitos: Python 3.11 ou superior, Node.js 20.19+ ou 22.12+, e uma chave da API Gemini criada no Google AI Studio.

1. Copie `.env.example` para `.env` e preencha `GEMINI_API_KEY`.

   No PowerShell:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

2. Em um terminal, instale e inicie a API:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn main:app --reload --host 127.0.0.1 --port 8000
   ```

3. Em outro terminal, instale e inicie a interface React:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

4. Abra `http://127.0.0.1:5173`.

No Linux/macOS, os comandos equivalentes são `python3 -m venv .venv`, `source .venv/bin/activate` e os mesmos comandos `pip`, `uvicorn` e `npm`.

Depois de `npm run build` dentro de `frontend/`, a FastAPI serve a interface compilada em `http://127.0.0.1:8000`.

## Aplicativo web no GitHub Pages

O GitHub Pages publica a interface React como site estático. A API FastAPI e a chave Gemini continuam em um backend separado, que deve ter URL HTTPS pública para o navegador do Pages conseguir acessá-lo. O workflow em .github/workflows/deploy-pages.yml compila e publica o frontend quando há push na branch main.

### Configurar publicação

1. Coloque o conteúdo desta pasta na raiz do repositório que receberá a interface.
2. Em Settings → Pages, selecione GitHub Actions como fonte de publicação.
3. Em Settings → Secrets and variables → Actions → Variables, crie a variável FINCORE_API_BASE_URL com a URL HTTPS base da API, por exemplo https://api.seudominio.com. Essa URL é pública e será incorporada ao JavaScript do site.
4. No ambiente do backend, configure FINCORE_ALLOWED_ORIGINS com a origem do Pages, por exemplo https://seu-usuario.github.io. Se usar domínio próprio, inclua a origem do domínio.
5. Faça push para main ou execute o workflow manualmente.

A chave GEMINI_API_KEY deve ficar somente no ambiente privado do backend. Nunca a coloque em VITE_API_BASE_URL, no GitHub Pages ou em um arquivo .env do frontend. CORS limita chamadas feitas por navegadores, mas não autentica o backend; antes de deixar a API pública, adicione limitação de requisições ou outro controle para proteger a cota Gemini.

Para execução local, use a URL relativa da API; o Vite já encaminha /api para http://127.0.0.1:8000. Configure as chaves e as origens no .env da raiz do backend.

## Fluxo demonstrado

```text
Binance pública → indicadores calculados no backend → Gemini em JSON
                                           ↓
                         validação dos oito papéis
                                           ↓
                 Release Gate determinístico bloqueado
```

Rotas principais: `/health`, `/ready`, `/api/status`, `/api/market`, `/api/analyze`, `/api/risk/status` e `/api/system/kill-switch/activate`. A documentação interativa da API fica em `/docs`.

## Limites desta PoC

- Não envia, prepara ou cancela ordens. Não há conexão de carteira, credenciais de exchange ou endpoint de execução.
- A análise é uma chamada Gemini para os oito papéis, não oito adapters SLM independentes.
- FRED/BCB, carteira, MySQL HeatWave, Data Lake, alertas, push, backtests, walk-forward, CLI e aplicativos nativos Android/iOS não estão conectados nesta versão.
- Não há persistência de análises nem de estado. O Kill Switch fica em memória e é limpo ao reiniciar o servidor; não exponha esta PoC publicamente.
- O Release Gate permanece bloqueado porque os thresholds individuais de confiabilidade e consistência não foram avaliados em backtest e walk-forward. Uma resposta do Gemini não libera autonomia.
- A resposta do Gemini é conteúdo de demonstração, não recomendação financeira. A integração deve receber apenas dados públicos; não envie chaves privadas, credenciais ou dados pessoais.

## Configuração Gemini

`GEMINI_MODEL` é configurável. O padrão é `gemini-3.1-flash-lite`, modelo com opção de uso gratuito na API Gemini conforme a tabela de preços consultada em 27/10/2026. A disponibilidade, a cota e os limites podem variar por projeto e conta. No nível gratuito, a documentação informa que os dados enviados podem ser usados para melhorar produtos do Google; evite enviar dados privados.

## Referências

- [Google AI Studio — criar uma chave Gemini](https://aistudio.google.com/apikey)
- [Modelos da API Gemini](https://ai.google.dev/gemini-api/docs/models)
- [Preços e nível gratuito da API Gemini](https://ai.google.dev/gemini-api/docs/pricing)
- [Saída estruturada JSON do Gemini](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Documentação oficial da Binance Spot REST API](https://developers.binance.com/en/docs/products/spot/rest-api)
- [React — documentação oficial](https://react.dev/)
- [Vite — documentação oficial](https://vite.dev/guide/)
