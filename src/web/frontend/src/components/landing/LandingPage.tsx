const metrics = [
  ['AES', 'local vault'],
  ['24', 'model providers'],
  ['ENV', 'project mapping'],
  ['CLI', 'access checks'],
];

const featureRows = [
  ['Project Secrets', 'Keep model keys, cloud credentials, and service tokens encrypted locally and mapped per project.'],
  ['Model Providers', 'Manage OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Volcengine, and local providers in one place.'],
  ['CLI Access', 'Check tool installs, repair missing dependencies, and see which CLIs need authorization.'],
  ['Sync Boundary', 'Move access configuration across machines without scattering raw credentials everywhere.'],
];

const logLines = [
  ['check', 'gh, uv, wrangler, docker', 'healthy'],
  ['vault', 'OPENROUTER_KEY/project', 'sealed'],
  ['models', 'openai/gpt-5.5 -> web-app', 'active'],
  ['cloud', 'cloudflare -> project env', 'mapped'],
];

function StatusDot({ tone = 'green' }: { tone?: 'green' | 'blue' | 'gray' }) {
  return <span className={`landing-dot landing-dot--${tone}`} />;
}

export default function LandingPage() {
  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <a className="landing-wordmark" href="/landing" aria-label="OKIT landing page">
          <span className="landing-mark">OK</span>
          <span>OKIT</span>
        </a>
        <nav className="landing-links" aria-label="Primary">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href="#install">Install</a>
          <a href="https://github.com/dolphin-molt/okit">GitHub</a>
        </nav>
        <a className="landing-nav-cta" href="/">Dashboard</a>
      </header>

      <main>
        <section className="landing-hero" id="product">
          <div className="landing-hero-copy">
            <p className="landing-terminal-line">$ okit access status</p>
            <h1>OKIT</h1>
            <p className="landing-lede">
              Access layer for local development. Manage project secrets, model providers, cloud credentials, and CLI access from one encrypted workspace.
            </p>
            <div className="landing-actions">
              <a className="landing-btn landing-btn--primary" href="#install">Install CLI</a>
              <a className="landing-btn landing-btn--secondary" href="/">Open Dashboard</a>
            </div>
            <div className="landing-metrics" aria-label="Product highlights">
              {metrics.map(([value, label]) => (
                <div className="landing-metric" key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
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
              <span>dev-access.local</span>
            </div>
            <div className="landing-console-body">
              <aside className="landing-console-rail">
                {['Tools', 'Vault', 'Models', 'Relay'].map((item, index) => (
                  <div className={index === 0 ? 'active' : ''} key={item}>{item}</div>
                ))}
              </aside>
              <div className="landing-console-main">
                <div className="landing-console-head">
                  <div>
                    <span className="landing-label">Command Center</span>
                    <h2>Project access ready</h2>
                  </div>
                  <span className="landing-live"><StatusDot />Live</span>
                </div>
                <div className="landing-grid-cards">
                  <div>
                    <span>Tool health</span>
                    <strong>92%</strong>
                  </div>
                  <div>
                    <span>Vault keys</span>
                    <strong>18</strong>
                  </div>
                  <div>
                    <span>Providers</span>
                    <strong>24</strong>
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
                  <span>$ okit vault inject --project ./web-app</span>
                  <span>export OPENAI_API_KEY=okit://vault/OPENAI_API_KEY</span>
                  <span>export CLOUDFLARE_API_TOKEN=okit://vault/CF_API_TOKEN</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-band" id="workflow">
          <div className="landing-section-head">
            <span>What it controls</span>
            <h2>One encrypted access layer for the credentials every project depends on.</h2>
          </div>
          <div className="landing-feature-list">
            {featureRows.map(([title, body]) => (
              <article className="landing-feature" key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-install" id="install">
          <div>
            <span>Install</span>
            <h2>Bring the toolkit into your shell.</h2>
          </div>
          <pre><code>npm install -g okit-cli{'\n'}okit web</code></pre>
        </section>
      </main>
    </div>
  );
}
