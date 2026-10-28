"""Small FinCore application PoC: public market data + Gemini analysis."""

from __future__ import annotations

import os
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
CONFIG_DIR = Path(os.getenv("FINCORE_CONFIG_DIR", ROOT))
load_dotenv(CONFIG_DIR / ".env")

FRONTEND_DIST = ROOT / "frontend" / "dist"
FRONTEND_ASSETS = FRONTEND_DIST / "assets"
BINANCE_BASE_URL = "https://data-api.binance.vision"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").strip()

Symbol = Literal["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"]
Interval = Literal["15m", "1h", "4h", "1d"]
Recommendation = Literal["LONG", "SHORT", "HOLD"]
AgentStance = Literal["bullish", "bearish", "neutral", "blocked"]

AGENT_ORDER = [
    "Market Agent",
    "Technical Agent",
    "Macro Agent",
    "Strategy Agent",
    "Risk Agent",
    "Portfolio Agent",
    "Execution Agent",
    "Supervisor Agent",
]

KILL_SWITCH_ACTIVE = False
KILL_SWITCH_ACTIVATED_AT: str | None = None

app = FastAPI(
    title="FinCore PoC",
    description="Painel demonstrativo de análise financeira com Gemini e dados públicos.",
    version="0.1.0",
)
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "FINCORE_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
if FRONTEND_ASSETS.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS), name="assets")


class CandlePoint(BaseModel):
    time: int
    close: float


class MarketSnapshot(BaseModel):
    symbol: str
    interval: str
    as_of_utc: str
    last_price: float
    change_24h_pct: float
    high_24h: float
    low_24h: float
    quote_volume_24h: float
    sma20: float
    sma50: float
    rsi14: float
    volatility_pct: float
    trend: str
    price_history: list[CandlePoint]
    data_source: str = "Binance Spot — API pública"


class AgentFinding(BaseModel):
    role: Literal[
        "Market Agent",
        "Technical Agent",
        "Macro Agent",
        "Strategy Agent",
        "Risk Agent",
        "Portfolio Agent",
        "Execution Agent",
        "Supervisor Agent",
    ]
    stance: AgentStance
    summary: str = Field(min_length=1, max_length=500)
    evidence: list[str] = Field(default_factory=list, max_length=3)


class NetworkAnalysis(BaseModel):
    recommendation: Recommendation
    summary: str = Field(min_length=1, max_length=1200)
    agents: list[AgentFinding] = Field(min_length=8, max_length=8)
    risk_flags: list[str] = Field(default_factory=list, max_length=8)


class AnalyzeRequest(BaseModel):
    symbol: Symbol = "BTCUSDT"
    interval: Interval = "1h"


class ReleaseGate(BaseModel):
    status: Literal["BLOCKED"] = "BLOCKED"
    reliability_threshold: str = "75% por agente — não avaliado"
    consistency_threshold: str = "75% por agente — não avaliado"
    reasons: list[str]


def _average(values: list[float]) -> float:
    return statistics.fmean(values)


def _rsi14(closes: list[float]) -> float:
    changes = [closes[index] - closes[index - 1] for index in range(1, len(closes))]
    recent = changes[-14:]
    gains = [max(change, 0.0) for change in recent]
    losses = [abs(min(change, 0.0)) for change in recent]
    average_gain = _average(gains)
    average_loss = _average(losses)
    if average_loss == 0:
        return 100.0 if average_gain > 0 else 50.0
    relative_strength = average_gain / average_loss
    return 100 - (100 / (1 + relative_strength))


def _release_gate() -> ReleaseGate:
    reasons = [
        "A PoC usa Gemini; não comprova os adapters Qwen3 treinados.",
        "Não há métricas persistidas de backtest e walk-forward para os oito agentes.",
        "A execução real permanece desativada nesta PoC.",
    ]
    if KILL_SWITCH_ACTIVE:
        reasons.insert(0, "Kill Switch ativo: novas análises estratégicas estão bloqueadas.")
    return ReleaseGate(reasons=reasons)


def fetch_market_snapshot(symbol: Symbol, interval: Interval) -> MarketSnapshot:
    try:
        with httpx.Client(timeout=12.0) as client:
            ticker_response = client.get(
                f"{BINANCE_BASE_URL}/api/v3/ticker/24hr",
                params={"symbol": symbol},
            )
            ticker_response.raise_for_status()
            ticker = ticker_response.json()

            candles_response = client.get(
                f"{BINANCE_BASE_URL}/api/v3/klines",
                params={"symbol": symbol, "interval": interval, "limit": 100},
            )
            candles_response.raise_for_status()
            raw_candles = candles_response.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 429:
            raise HTTPException(
                status_code=503,
                detail="A Binance limitou temporariamente as consultas. Aguarde e tente novamente.",
            ) from exc
        raise HTTPException(
            status_code=502,
            detail="A fonte pública da Binance não respondeu com sucesso.",
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Não foi possível obter dados públicos da Binance.",
        ) from exc

    try:
        candles = [
            {
                "time": int(row[0]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
            }
            for row in raw_candles
        ]
        closes = [candle["close"] for candle in candles]
        if len(closes) < 50:
            raise ValueError("A Binance retornou candles insuficientes para os indicadores.")

        sma20 = _average(closes[-20:])
        sma50 = _average(closes[-50:])
        separation_pct = ((sma20 - sma50) / sma50) * 100 if sma50 else 0.0
        if separation_pct > 0.2:
            trend = "Alta"
        elif separation_pct < -0.2:
            trend = "Baixa"
        else:
            trend = "Lateral"

        returns_pct = [
            ((closes[index] / closes[index - 1]) - 1) * 100
            for index in range(max(1, len(closes) - 20), len(closes))
        ]
        volatility_pct = statistics.pstdev(returns_pct) if len(returns_pct) > 1 else 0.0

        return MarketSnapshot(
            symbol=symbol,
            interval=interval,
            as_of_utc=datetime.now(timezone.utc).isoformat(),
            last_price=float(ticker["lastPrice"]),
            change_24h_pct=float(ticker["priceChangePercent"]),
            high_24h=float(ticker["highPrice"]),
            low_24h=float(ticker["lowPrice"]),
            quote_volume_24h=float(ticker["quoteVolume"]),
            sma20=sma20,
            sma50=sma50,
            rsi14=_rsi14(closes),
            volatility_pct=volatility_pct,
            trend=trend,
            price_history=[
                CandlePoint(time=candle["time"], close=candle["close"])
                for candle in candles[-48:]
            ],
        )
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Os dados recebidos da Binance não passaram pela validação da PoC.",
        ) from exc


def _analysis_prompt(snapshot: MarketSnapshot) -> str:
    market_json = snapshot.model_dump_json(indent=2)
    return f"""Você é a camada cognitiva temporária da PoC FinCore. Para esta demonstração, Gemini substitui somente a inferência da SLM Qwen3-1.7B; não é um modelo treinado do FinCore.

Analise os dados abaixo e produza uma resposta estruturada para os oito papéis da rede. Escreva em português do Brasil.

Regras obrigatórias:
- Use somente os dados presentes no JSON. Não pesquise, invente preços, indicadores, notícias, posições ou contexto macroeconômico.
- As fontes macroeconômicas FRED e BCB não estão conectadas. O Macro Agent deve marcar a análise como bloqueada e explicar a ausência de dados.
- Não há carteira conectada. O Portfolio Agent deve registrar essa limitação e não inventar saldo ou posições.
- O Execution Agent deve sempre ficar bloqueado: esta aplicação não envia nem prepara ordens reais.
- O Supervisor Agent deve explicar que a autorização autônoma continua bloqueada pela validação determinística.
- A recomendação é somente uma interpretação de mercado (LONG, SHORT ou HOLD), nunca uma ordem.
- O Risk Agent aponta riscos e limitações; regras determinísticas externas têm autoridade sobre qualquer saída do modelo.
- Não afirme que confiabilidade, consistência ou thresholds foram atingidos.

Papéis, exatamente nesta ordem: {", ".join(AGENT_ORDER)}.

Dados de mercado:
{market_json}
"""


def _gemini_analysis(snapshot: MarketSnapshot) -> NetworkAnalysis:
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY não configurada. Crie uma chave no Google AI Studio e adicione ao arquivo .env.",
        )

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=_analysis_prompt(snapshot),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=NetworkAnalysis,
                max_output_tokens=2200,
            ),
        )
        if not response.text:
            raise ValueError("Gemini retornou uma resposta vazia.")
        analysis = NetworkAnalysis.model_validate_json(response.text)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="A análise do Gemini falhou ou retornou um formato inválido. Nenhuma operação foi autorizada.",
        ) from exc

    roles = [agent.role for agent in analysis.agents]
    if len(roles) != len(AGENT_ORDER) or set(roles) != set(AGENT_ORDER):
        raise HTTPException(
            status_code=502,
            detail="A resposta do Gemini não incluiu os oito papéis esperados. Nenhuma operação foi autorizada.",
        )

    by_role = {agent.role: agent for agent in analysis.agents}
    by_role["Macro Agent"] = AgentFinding(
        role="Macro Agent",
        stance="blocked",
        summary="FRED e BCB não estão conectados nesta PoC; nenhuma conclusão macroeconômica foi inferida.",
        evidence=["Dados macroeconômicos indisponíveis"],
    )
    by_role["Portfolio Agent"] = AgentFinding(
        role="Portfolio Agent",
        stance="blocked",
        summary="A carteira não está conectada; saldo, exposição e posições não foram avaliados.",
        evidence=["Sem integração de carteira nesta PoC"],
    )
    by_role["Execution Agent"] = AgentFinding(
        role="Execution Agent",
        stance="blocked",
        summary="Execução desativada. A PoC não envia, prepara ou cancela ordens.",
        evidence=["Nenhuma credencial de exchange é utilizada"],
    )
    by_role["Supervisor Agent"] = AgentFinding(
        role="Supervisor Agent",
        stance="blocked",
        summary="Autonomia bloqueada: os gates de validação e aprovação do modelo não foram executados.",
        evidence=["Release Gate determinístico permanece bloqueado"],
    )

    normalized = analysis.model_copy(update={"agents": [by_role[role] for role in AGENT_ORDER]})
    if KILL_SWITCH_ACTIVE:
        normalized = normalized.model_copy(
            update={
                "recommendation": "HOLD",
                "summary": "Kill Switch ativo. A leitura permanece indisponível para novas decisões estratégicas.",
                "risk_flags": list(dict.fromkeys(["Kill Switch ativo", *normalized.risk_flags])),
            }
        )
    return normalized


@app.get("/", include_in_schema=False, response_model=None)
def index() -> FileResponse | HTMLResponse:
    built_index = FRONTEND_DIST / "index.html"
    if built_index.is_file():
        return FileResponse(built_index)
    return HTMLResponse(
        "<p>FinCore API ativa. Para abrir o painel React, execute <code>npm run dev</code> em <code>frontend/</code>.</p>"
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "FinCore PoC"}


@app.get("/ready")
def ready() -> dict[str, bool | str]:
    return {
        "ready": bool(GEMINI_API_KEY),
        "gemini_model": GEMINI_MODEL,
        "reason": "Configure GEMINI_API_KEY no .env" if not GEMINI_API_KEY else "Gemini configurado",
    }


@app.get("/api/status")
def status() -> dict[str, object]:
    return {
        "app": "FinCore PoC",
        "trading_mode": "paper",
        "gemini_ready": bool(GEMINI_API_KEY),
        "gemini_model": GEMINI_MODEL,
        "market_data_provider": "Binance Spot — API pública, somente leitura",
        "macro_data_connected": False,
        "portfolio_connected": False,
        "live_trading_enabled": False,
        "kill_switch_active": KILL_SWITCH_ACTIVE,
        "kill_switch_activated_at": KILL_SWITCH_ACTIVATED_AT,
        "release_gate": _release_gate().model_dump(),
    }


@app.get("/api/market", response_model=MarketSnapshot)
def get_market(
    symbol: Symbol = Query(default="BTCUSDT"),
    interval: Interval = Query(default="1h"),
) -> MarketSnapshot:
    return fetch_market_snapshot(symbol, interval)


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, object]:
    if KILL_SWITCH_ACTIVE:
        raise HTTPException(
            status_code=423,
            detail="Kill Switch ativo. Análises estratégicas estão bloqueadas; dados públicos continuam disponíveis.",
        )
    snapshot = fetch_market_snapshot(request.symbol, request.interval)
    analysis = _gemini_analysis(snapshot)
    return {
        "market": snapshot.model_dump(),
        "analysis": analysis.model_dump(),
        "release_gate": _release_gate().model_dump(),
        "model_provider": "Gemini API (substituto temporário da SLM)",
    }


@app.get("/api/risk/status")
def risk_status() -> ReleaseGate:
    return _release_gate()


@app.post("/api/system/kill-switch/activate")
def activate_kill_switch() -> dict[str, object]:
    global KILL_SWITCH_ACTIVE, KILL_SWITCH_ACTIVATED_AT
    if not KILL_SWITCH_ACTIVE:
        KILL_SWITCH_ACTIVE = True
        KILL_SWITCH_ACTIVATED_AT = datetime.now(timezone.utc).isoformat()
    return {
        "active": KILL_SWITCH_ACTIVE,
        "activated_at": KILL_SWITCH_ACTIVATED_AT,
        "message": "Kill Switch ativado. Reiniciar o processo limpa este estado temporário da PoC.",
    }
