import { useI18n } from '../../i18n';

const metrics = [
  ['76+', 'landing.metric.tools'],
  ['AES', 'landing.metric.vault'],
  ['AI', 'landing.metric.assistant'],
  ['SYNC', 'landing.metric.sync'],
];

const featureRows = [
  ['landing.feature.ai.title', 'landing.feature.ai.body'],
  ['landing.feature.vault.title', 'landing.feature.vault.body'],
  ['landing.feature.models.title', 'landing.feature.models.body'],
  ['landing.feature.sync.title', 'landing.feature.sync.body'],
];

const logLines = [
  ['auth', 'gh, docker, wrangler', 'ready'],
  ['vault', 'MINIMAX_READO_KEY', 'encrypted'],
  ['models', 'openai/gpt-5.5 -> codex', 'active'],
  ['sync', 'cloudflare -> local vault', 'merged'],
];

function StatusDot({ tone = 'green' }: { tone?: 'green' | 'blue' | 'gray' }) {
  return <span className={`landing-dot landing-dot--${tone}`} />;
}

export default function LandingPage() {
  const { t, lang, setLang } = useI18n();
  const nextLang = lang === 'zh' ? 'en' : 'zh';

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <a className="landing-wordmark" href="/landing" aria-label="OKIT landing page">
          <span className="landing-mark">OK</span>
          <span>OKIT</span>
        </a>
        <nav className="landing-links" aria-label="Primary">
          <a href="#product">{t('landing.nav.product')}</a>
          <a href="#workflow">{t('landing.nav.workflow')}</a>
          <a href="#install">{t('landing.nav.install')}</a>
          <a href="https://github.com/dolphin-molt/okit">{t('landing.nav.github')}</a>
        </nav>
        <div className="landing-nav-actions">
          <button
            className="landing-lang-toggle"
            onClick={() => setLang(nextLang)}
            title={t('nav.language')}
            type="button"
          >
            {lang === 'zh' ? 'EN' : '中'}
          </button>
          <a className="landing-nav-cta" href="/">{t('landing.nav.dashboard')}</a>
        </div>
      </header>

      <main>
        <section className="landing-hero" id="product">
          <div className="landing-hero-copy">
            <p className="landing-terminal-line">$ okit access status</p>
            <h1>OKIT</h1>
            <p className="landing-lede">
              {t('landing.lede')}
            </p>
            <div className="landing-actions">
              <a className="landing-btn landing-btn--primary" href="#install">{t('landing.cta.install')}</a>
              <a className="landing-btn landing-btn--secondary" href="/">{t('landing.cta.dashboard')}</a>
            </div>
            <div className="landing-metrics" aria-label="Product highlights">
              {metrics.map(([value, labelKey]) => (
                <div className="landing-metric" key={labelKey}>
                  <strong>{value}</strong>
                  <span>{t(labelKey)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-console" aria-label="OKIT command center preview">
            <div className="landing-console-glow" />
            <div className="landing-console-top">
              <div>
                <span className="landing-window-dot" />
                <span className="landing-window-dot" />
                <span className="landing-window-dot" />
              </div>
              <span>localhost:3780</span>
            </div>
            <div className="landing-console-body">
              <aside className="landing-console-rail">
                {['AI', 'Vault', 'Models', 'Sync'].map((item, index) => (
                  <div className={index === 0 ? 'active' : ''} key={item}>{item}</div>
                ))}
              </aside>
              <div className="landing-console-main">
                <div className="landing-console-head">
                  <div>
                    <span className="landing-label">{t('landing.console.label')}</span>
                    <h2>{t('landing.console.title')}</h2>
                  </div>
                  <span className="landing-live"><StatusDot />{t('landing.console.live')}</span>
                </div>
                <div className="landing-grid-cards">
                  <div>
                    <span>{t('landing.console.toolHealth')}</span>
                    <strong>76+</strong>
                  </div>
                  <div>
                    <span>{t('landing.console.vaultAliases')}</span>
                    <strong>AES</strong>
                  </div>
                  <div>
                    <span>{t('landing.console.cloudSync')}</span>
                    <strong>KV</strong>
                  </div>
                </div>
                <div className="landing-log">
                  {logLines.map(([cmd, target, state], index) => (
                    <div className="landing-log-row" key={cmd}>
                      <StatusDot tone={index === 2 ? 'blue' : index === 3 ? 'green' : 'gray'} />
                      <code>{cmd}</code>
                      <span>{target}</span>
                      <b>{state}</b>
                    </div>
                  ))}
                </div>
                <div className="landing-terminal">
                  <span>$ okit vault sync --project ./agent-app</span>
                  <span>OPENAI_API_KEY: OPENROUTER_KEY/team</span>
                  <span>MINIMAX_API_KEY: MINIMAX_READO_KEY/project</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-band" id="workflow">
          <div className="landing-section-head">
            <span>{t('landing.workflow.kicker')}</span>
            <h2>{t('landing.workflow.title')}</h2>
          </div>
          <div className="landing-feature-list">
            {featureRows.map(([title, body]) => (
              <article className="landing-feature" key={title}>
                <h3>{t(title)}</h3>
                <p>{t(body)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-install" id="install">
          <div>
            <span>{t('landing.install.kicker')}</span>
            <h2>{t('landing.install.title')}</h2>
          </div>
          <pre><code>npm install -g @cing-self/okit-cli{'\n'}okit web</code></pre>
        </section>
      </main>
    </div>
  );
}
