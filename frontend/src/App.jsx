import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "./Icon.jsx";

const AGENT_ROLES = [
  "Market Agent",
  "Technical Agent",
  "Macro Agent",
  "Strategy Agent",
  "Risk Agent",
  "Portfolio Agent",
  "Execution Agent",
  "Supervisor Agent",
];

const STANCE_LABELS = {
  bullish: "Viés positivo",
  bearish: "Viés negativo",
  neutral: "Neutro",
  blocked: "Bloqueado",
};

const RECOMMENDATION_LABELS = {
  LONG: "Viés LONG",
  SHORT: "Viés SHORT",
  HOLD: "HOLD",
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
const API_DOCS_URL = API_BASE_URL
  ? API_BASE_URL + "/docs"
  : import.meta.env.DEV
    ? "http://127.0.0.1:8000/docs"
    : "";

async function api(path, options) {
  if (import.meta.env.PROD && !API_BASE_URL) {
    throw new Error("Backend não configurado. Defina VITE_API_BASE_URL no build do site.");
  }
  const endpoint = API_BASE_URL ? API_BASE_URL + path : path;
  const response = await fetch(endpoint, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || "Falha na API (" + response.status + ").");
  }
  return body;
}

function formatPrice(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value));
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2).replace(".", ",")}%`;
}

function formatVolume(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Number(value))} USDT`;
}

function formatTime(value) {
  if (!value) return "Aguardando dados da Binance";
  return `Atualizado ${new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function buildChart(history) {
  if (!history || history.length < 2) return null;
  const values = history.map((point) => Number(point.close));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, max * 0.0001, 0.000001);
  const points = values.map((value, index) => {
    const x = 18 + (index / (values.length - 1)) * 764;
    const y = 18 + ((max - value) / range) * 188;
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L782,225 L18,225 Z`;
  return { line, area, positive: values.at(-1) >= values[0] };
}

function NavLink({ href, icon, children, active = false }) {
  return (
    <a className={`nav-link${active ? " active" : ""}`} href={href} aria-current={active ? "page" : undefined}>
      <Icon name={icon} />
      <span>{children}</span>
    </a>
  );
}

function PanelHeading({ title, trailing }) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      {trailing}
    </div>
  );
}

function PriceChart({ market }) {
  const chart = useMemo(() => buildChart(market?.price_history), [market?.price_history]);
  if (!chart) {
    return <div className="chart-empty">O gráfico aparecerá quando os dados públicos forem carregados.</div>;
  }

  return (
    <svg className="price-chart" viewBox="0 0 800 250" preserveAspectRatio="none" role="img" aria-label="Histórico recente do preço">
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={chart.positive ? "#0a8f6a" : "#b54747"} stopOpacity="0.14" />
          <stop offset="100%" stopColor={chart.positive ? "#0a8f6a" : "#b54747"} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[46, 104, 162, 220].map((y) => <line key={y} x1="18" x2="782" y1={y} y2={y} className="chart-grid-line" />)}
      <path d={chart.area} fill="url(#chartFill)" />
      <path d={chart.line} className={`chart-line${chart.positive ? " positive" : " negative"}`} />
    </svg>
  );
}

function AgentList({ agents }) {
  const byRole = new Map((agents || []).map((agent) => [agent.role, agent]));
  return (
    <div className="agent-list">
      {AGENT_ROLES.map((role, index) => {
        const agent = byRole.get(role);
        if (!agent) {
          return (
            <div className="agent-row waiting" key={role}>
              <span className="agent-number">{index + 1}</span>
              <span className="agent-name">{role}</span>
              <span className="agent-status">Aguardando</span>
            </div>
          );
        }
        return (
          <details className={`agent-row agent-${agent.stance}`} key={role}>
            <summary>
              <span className="agent-number">{index + 1}</span>
              <span className="agent-name">{role}</span>
              <span className="agent-status">{STANCE_LABELS[agent.stance] || agent.stance}</span>
            </summary>
            <div className="agent-detail">
              <p>{agent.summary}</p>
              {agent.evidence?.length > 0 && (
                <ul>{agent.evidence.map((item, itemIndex) => <li key={`${role}-${itemIndex}`}>{item}</li>)}</ul>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function AnalysisResult({ result }) {
  if (!result) {
    return (
      <div className="analysis-result">
        <p className="empty-copy">Atualize o mercado e escolha <strong>Analisar mercado</strong> para consultar a rede de agentes.</p>
        <p className="fine-print">A resposta do Gemini é interpretativa, não é uma ordem nem comprova desempenho da SLM.</p>
      </div>
    );
  }

  return (
    <div className="analysis-result">
      <div className="recommendation-row">
        <span className="eyebrow">Sinal interpretativo</span>
        <span className={`recommendation recommendation-${result.analysis.recommendation.toLowerCase()}`}>
          {RECOMMENDATION_LABELS[result.analysis.recommendation] || result.analysis.recommendation}
        </span>
      </div>
      <p className="analysis-summary">{result.analysis.summary}</p>
      <p className="fine-print">Nenhuma ordem foi criada. A autorização autônoma continua bloqueada pelo Release Gate.</p>
      {result.analysis.risk_flags?.length > 0 && (
        <div className="risk-flags">
          <span className="eyebrow">Riscos e limitações indicados</span>
          <ul>{result.analysis.risk_flags.map((flag, index) => <li key={`risk-${index}`}>{flag}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function App() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [market, setMarket] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [serverStatus, setServerStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [marketBusy, setMarketBusy] = useState(true);
  const [notice, setNotice] = useState(null);

  const refreshMarket = useCallback(async (requestedSymbol = symbol, requestedInterval = interval) => {
    setMarketBusy(true);
    setMarket(null);
    setAnalysis(null);
    try {
      const data = await api(`/api/market?symbol=${requestedSymbol}&interval=${requestedInterval}`);
      setMarket(data);
      setNotice(null);
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setMarketBusy(false);
    }
  }, [interval, symbol]);

  const refreshStatus = useCallback(async () => {
    try {
      setServerStatus(await api("/api/status"));
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.PROD && !API_BASE_URL) {
      setMarketBusy(false);
      setNotice({
        kind: "warning",
        text: "Configure a URL do backend FastAPI na variável VITE_API_BASE_URL para conectar os dados e o Gemini.",
      });
      return;
    }
    refreshStatus();
    refreshMarket("BTCUSDT", "1h");
  }, []);

  useEffect(() => {
    if (serverStatus && !serverStatus.gemini_ready) {
      setNotice({ kind: "warning", text: "Configure GEMINI_API_KEY no arquivo .env para habilitar a análise dos agentes." });
    }
  }, [serverStatus]);

  async function runAnalysis(event) {
    event.preventDefault();
    setBusy(true);
    setAnalysis(null);
    setNotice(null);
    try {
      const response = await api("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval }),
      });
      setMarket(response.market);
      setAnalysis(response);
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function activateKillSwitch() {
    try {
      await api("/api/system/kill-switch/activate", { method: "POST" });
      setAnalysis(null);
      await refreshStatus();
      setNotice({ kind: "warning", text: "Kill Switch ativado. As cotações públicas continuam disponíveis; novas análises estratégicas foram bloqueadas." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }

  const marketIsPositive = Number(market?.change_24h_pct || 0) >= 0;
  const symbolLabel = symbol.replace("USDT", "/USDT");
  const intervalLabels = { "15m": "15 min", "1h": "1 hora", "4h": "4 horas", "1d": "1 dia" };
  const killActive = Boolean(serverStatus?.kill_switch_active);
  const gateReasons = serverStatus?.release_gate?.reasons || [
    "Métricas de validação não disponíveis nesta PoC.",
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview">FinCore</a>
        <nav className="nav" aria-label="Navegação principal">
          <NavLink href="#overview" icon="home" active>Visão geral</NavLink>
          <NavLink href="#market" icon="chart">Análise de mercado</NavLink>
          <NavLink href="#analysis" icon="network">Análise da rede</NavLink>
          <NavLink href="#agents" icon="people">Agentes</NavLink>
          <NavLink href="#risk" icon="shield">Risco e autonomia</NavLink>
        </nav>
        <div className="sidebar-footer"><span className="live-dot" /> PoC local</div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="mode-label"><span className="mode-dot" /> Paper mode</div>
          <div className="readonly-label">Somente leitura <span aria-hidden="true">·</span> Execução real desativada</div>
        </header>

        <main id="overview" className="page-content">
          <div className="page-heading">
            <div>
              <h1>Visão geral</h1>
              <p>Mercado público, indicadores determinísticos e análise da rede FinCore.</p>
            </div>
            <div className="updated-at">{formatTime(market?.as_of_utc)}</div>
          </div>

          <form id="market" className="control-panel" onSubmit={runAnalysis}>
            <label className="field-label" htmlFor="symbolSelect">
              Ativo
              <select id="symbolSelect" value={symbol} onChange={(event) => {
                setSymbol(event.target.value);
                setAnalysis(null);
                refreshMarket(event.target.value, interval);
              }}>
                <option value="BTCUSDT">BTC/USDT</option>
                <option value="ETHUSDT">ETH/USDT</option>
                <option value="BNBUSDT">BNB/USDT</option>
                <option value="SOLUSDT">SOL/USDT</option>
              </select>
            </label>
            <label className="field-label interval-field" htmlFor="intervalSelect">
              Período
              <select id="intervalSelect" value={interval} onChange={(event) => {
                setInterval(event.target.value);
                setAnalysis(null);
                refreshMarket(symbol, event.target.value);
              }}>
                <option value="15m">15 min</option>
                <option value="1h">1 hora</option>
                <option value="4h">4 horas</option>
                <option value="1d">1 dia</option>
              </select>
            </label>
            <button className="button-primary" type="submit" disabled={busy || marketBusy || !serverStatus?.gemini_ready || killActive}>
              {busy ? <><span className="spinner" /> Analisando…</> : "Analisar mercado"}
            </button>
            <button className="button-refresh" type="button" onClick={() => refreshMarket()} disabled={marketBusy} aria-label="Atualizar cotação">
              <Icon name="refresh" />
              <span>{marketBusy ? "Atualizando…" : "Atualizar"}</span>
            </button>
          </form>

          {notice && <div className={`notice-bar ${notice.kind}`} role="status" aria-live="polite">{notice.text}</div>}

          <section className="primary-grid" aria-label="Dados de mercado">
            <article className="panel market-panel">
              <div className="panel-heading quote-heading">
                <div>
                  <h2>Cotação pública</h2>
                  <span className="muted">{symbolLabel}</span>
                </div>
                <span className={`data-status${market ? " connected" : ""}`}>
                  <span className="status-dot" /> {marketBusy ? "Consultando Binance" : market ? "Binance conectada" : "Sem dados"}
                </span>
              </div>
              <div className="quote-main">
                <div className="price-block">
                  <span className="eyebrow">Último preço</span>
                  <strong id="lastPrice">{market ? formatPrice(market.last_price) : "—"}</strong>
                  <span className="muted">USDT</span>
                </div>
                <div className="quote-stats">
                  <div><span>Variação (24h)</span><strong className={market ? (marketIsPositive ? "positive-text" : "negative-text") : ""}>{formatPercent(market?.change_24h_pct)}</strong></div>
                  <div><span>Máxima (24h)</span><strong>{formatPrice(market?.high_24h)}</strong></div>
                  <div><span>Mínima (24h)</span><strong>{formatPrice(market?.low_24h)}</strong></div>
                  <div><span>Volume (24h)</span><strong>{formatVolume(market?.quote_volume_24h)}</strong></div>
                </div>
              </div>
              <div className="chart-heading"><span>Preço recente</span><span>{intervalLabels[interval]}</span></div>
              <div className="chart-wrap">
                <PriceChart market={market} />
                <div className="chart-axis"><span>Histórico recente da Binance</span><span>{market ? formatPrice(market.price_history?.at(-1)?.close) : "—"} USDT</span></div>
              </div>
            </article>

            <div className="side-stack">
              <article className="panel indicator-panel">
                <PanelHeading title="Indicadores" trailing={<span className="mini-tag">calculados no servidor</span>} />
                <dl className="metric-list">
                  <div><dt>SMA 20</dt><dd>{formatPrice(market?.sma20)}</dd></div>
                  <div><dt>SMA 50</dt><dd>{formatPrice(market?.sma50)}</dd></div>
                  <div><dt>RSI 14</dt><dd>{market ? Number(market.rsi14).toFixed(2).replace(".", ",") : "—"}</dd></div>
                  <div><dt>Volatilidade</dt><dd>{formatPercent(market?.volatility_pct)}</dd></div>
                  <div><dt>Tendência</dt><dd>{market?.trend || "—"}</dd></div>
                </dl>
              </article>

              <article className="panel source-panel">
                <PanelHeading title="Dados disponíveis" />
                <div className="source-row"><span><span className={`status-dot${market ? " connected" : " muted-dot"}`} /> Binance pública</span><strong>{market ? "Conectada" : "Aguardando"}</strong></div>
                <div className="source-row"><span><span className="status-dot muted-dot" /> Macro (FRED/BCB)</span><strong>Não conectada</strong></div>
                <div className="source-row"><span><span className="status-dot muted-dot" /> Carteira</span><strong>Não conectada</strong></div>
                <div className={`provider-note${serverStatus?.gemini_ready ? " connected-text" : " warning-text"}`}>
                  {serverStatus?.gemini_ready ? `Gemini configurado · ${serverStatus.gemini_model}` : "Gemini sem chave configurada"}
                </div>
              </article>
            </div>
          </section>

          <section className="secondary-grid" aria-label="Análise e controles">
            <article id="analysis" className="panel analysis-panel">
              <PanelHeading title="Análise de mercado" trailing={<span className="muted">{analysis ? "Gemini · resposta estruturada" : "Aguardando análise"}</span>} />
              <AnalysisResult result={analysis} />
            </article>

            <article id="agents" className="panel agents-panel">
              <PanelHeading title="Agentes" trailing={<span className="mini-tag">8 papéis</span>} />
              <AgentList agents={analysis?.analysis.agents} />
            </article>

            <article id="risk" className="panel risk-panel">
              <PanelHeading title="Risco e autonomia" />
              <div className={`gate-banner${killActive ? " gate-kill" : ""}`}>
                <Icon name="lock" size={34} />
                <div><strong>{killActive ? "KILL SWITCH ATIVO" : "BLOQUEADO"}</strong><span>Execução real desativada</span></div>
              </div>
              <div className="threshold-list">
                <div><span>Confiabilidade mínima</span><strong>75% · não avaliada</strong></div>
                <div><span>Consistência mínima</span><strong>75% · não avaliada</strong></div>
              </div>
              <details className="gate-reasons">
                <summary>Por que está bloqueado?</summary>
                <ul>{gateReasons.map((reason, index) => <li key={`gate-${index}`}>{reason}</li>)}</ul>
              </details>
              <div className="kill-row">
                <div><strong>Kill Switch</strong><span>{killActive ? "Ativado nesta sessão" : "Pronto para ativação"}</span></div>
                <button className={`button-kill${killActive ? " is-active" : ""}`} type="button" onClick={activateKillSwitch} disabled={killActive}>
                  {killActive ? "Ativado" : "Ativar"}
                </button>
              </div>
              <p className="fine-print">O estado do Kill Switch fica em memória nesta PoC e é reiniciado ao reiniciar o servidor.</p>
            </article>
          </section>

          <footer className="page-footer">
            <span>FinCore PoC · dados públicos · sem ordens reais · sem credenciais de exchange</span>
            {API_DOCS_URL && <a href={API_DOCS_URL} target="_blank" rel="noreferrer">API FastAPI</a>}
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
