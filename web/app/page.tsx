'use client'
import { useState } from 'react'
import Link from 'next/link'

const t = {
  en: {
    badge: 'Decentralized AI Compute · Beta',
    heroH1a: 'Your GPU.',
    heroH1b: "The World's LLM.",
    heroSub: 'Enigma connects idle gaming GPUs with users who need AI inference — no cloud, no middlemen. Earn ENI tokens for every prompt you serve.',
    ctaUser: 'Start Using AI →',
    ctaProvider: 'Become a Provider',
    stat1: 'GPU Nodes Available',
    stat2: 'ENI per Job Completed',
    stat3: 'ENI Welcome Bonus',
    stat4: 'Platform Fee (Beta)',
    howLabel: '// How It Works',
    howTitle: 'Three actors.\nOne network.',
    howSub: 'Enigma orchestrates AI inference across a global mesh of consumer hardware through cryptographic incentives.',
    step1Title: 'User sends prompt',
    step1: 'Submit any text prompt via the web dashboard or API. Pay 1 ENI per request. Your request is routed to the best available provider node.',
    step2Title: 'Network routes job',
    step2: 'The coordinator selects the optimal provider using a composite score: benchmark quality × user rating × reliability. Best node wins the job.',
    step3Title: 'Provider earns ENI',
    step3: 'Your GPU runs the inference locally via Ollama or llama.cpp. Result is returned, validated, and ENI tokens are credited to your wallet.',
    forUsers: 'For Users',
    userTitle: 'AI without Big Tech',
    userDesc: 'Access powerful language models without sending your data to centralized clouds. Community-hosted, open, and private.',
    userFeatures: [
      '10 ENI welcome bonus — start immediately',
      'Choose from multiple models: Gemma, Phi, Llama',
      'Rate providers and shape the network quality',
      'No subscription, pay per prompt',
      'Your data stays in the network, not in a datacenter',
    ],
    userCta: 'Get 10 ENI Free →',
    forProviders: 'For Providers',
    providerTitle: 'Put your GPU to work',
    providerDesc: 'Your gaming PC earns real value while you sleep. Configure once, run forever — everything in Docker, fully automated.',
    providerFeatures: [
      'Runs as Docker containers — isolated and safe',
      'Auto-detects your GPU and recommends models',
      'Multi-model: run 2–4 LLMs on one GPU simultaneously',
      'Earn ENI per inference, view earnings in real-time',
      'Works on Linux, macOS and Windows',
    ],
    providerCta: 'Become a Provider →',
    tokenLabel: '// ENI Token',
    tokenTitle: "Fair by design.\nPowered by ENI.",
    tokenSub: 'ENI is the token that keeps Enigma honest — ensuring users never get exploited and providers always get rewarded. No middlemen. No hidden fees. Pure balance.',
    tf1Title: 'Fair use for users',
    tf1: 'Pay only for what you use. ENI costs a fraction of a cent per request — with a free daily claim of 10 ENI, most users never run out. AI for everyone.',
    tf2Title: 'Real rewards for providers',
    tf2: 'Every inference your GPU serves earns ENI — automatically, instantly, on-chain. The better your node performs, the more jobs it receives. Quality is rewarded.',
    tf3Title: 'Built-in balance',
    tf3: 'ENI creates a self-regulating equilibrium: when demand rises, providers earn more. When supply grows, costs drop for users. The market finds the fair price.',
    tf4Title: 'Governance (coming)',
    tf4: 'ENI holders will shape the future — voting on fees, routing rules, and protocol upgrades. The network belongs to its participants.',
    archLabel: '// Architecture',
    archTitle: 'Built for scale',
    archSub: 'Interface-driven architecture means every component is swappable — from SQLite to blockchain, from round-robin to distributed schedulers.',
    archScalePath: 'Scale path: RegistryStore → etcd · Router → Distributed Scheduler · Ledger → Blockchain',
    apiLabel: '// API Integrations',
    apiTitle: 'Works with your\nexisting tools.',
    apiSub: 'Enigma speaks the protocols your tools already use — drop in as an OpenAI or Ollama endpoint with no code changes.',
    apiCode: `from openai import OpenAI

client = OpenAI(
    base_url="https://www.enigmanet.org/v1",
    api_key="enk_your_key_here",
)

response = client.chat.completions.create(
    model="phi3:mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
    apiFeature1: 'OpenAI-compatible  /v1/chat/completions',
    apiFeature1Desc: 'Cline, LangChain, n8n, Continue.dev, AnythingLLM, AutoGen — just swap the base URL',
    apiFeature2: 'Ollama-compatible  /api/generate + /api/chat',
    apiFeature2Desc: 'Open WebUI, Msty, Homebrew and any Ollama client — set host to enigmanet.org',
    apiFeature3: 'Anthropic Messages API + MCP  (planned)',
    apiFeature3Desc: 'Claude Desktop, Cursor agent mode and MCP-native tools — coming soon',
    apiCta: 'Get API Key →',
    ctaTitle: 'Join the grid.',
    ctaSub: 'Start earning or start building — no setup fees, no lock-in.',
    ctaFree: 'Get 10 ENI Free →',
    ctaNode: 'Run a Provider Node',
    ctaDash: 'View Dashboard',
    navHow: 'How it works',
    navToken: 'ENI Token',
    navProviders: 'Providers',
    navDash: 'Dashboard',
    navStart: 'Get Started',
    footerCopy: '© 2026 Enigma Network · Beta',
  },
  de: {
    badge: 'Dezentrales KI-Compute-Netzwerk · Beta',
    heroH1a: 'Deine GPU.',
    heroH1b: 'Das LLM der Welt.',
    heroSub: 'Enigma verbindet ungenutzte Gaming-GPUs mit Nutzern, die KI-Inferenz benötigen — kein Cloud-Anbieter, keine Zwischenhändler. Verdiene ENI-Token für jede beantwortete Anfrage.',
    ctaUser: 'KI sofort nutzen →',
    ctaProvider: 'Provider werden',
    stat1: 'GPU-Nodes verfügbar',
    stat2: 'ENI pro abgeschlossenem Job',
    stat3: 'ENI Willkommensbonus',
    stat4: 'Plattformgebühr (Beta)',
    howLabel: '// Wie es funktioniert',
    howTitle: 'Drei Akteure.\nEin Netzwerk.',
    howSub: 'Enigma orchestriert KI-Inferenz über ein globales Mesh aus Consumer-Hardware durch kryptographische Anreize.',
    step1Title: 'User sendet Prompt',
    step1: 'Sende beliebigen Text über das Web-Dashboard oder die API. Zahle 1 ENI pro Anfrage. Deine Anfrage wird automatisch zum besten verfügbaren Provider geroutet.',
    step2Title: 'Netzwerk routet den Job',
    step2: 'Der Koordinator wählt den optimalen Provider anhand eines zusammengesetzten Scores: Benchmark-Qualität × Nutzerbewertung × Zuverlässigkeit.',
    step3Title: 'Provider verdient ENI',
    step3: 'Deine GPU führt die Inferenz lokal via Ollama oder llama.cpp aus. Das Ergebnis wird zurückgegeben, validiert, und ENI-Token werden gutgeschrieben.',
    forUsers: 'Für Nutzer',
    userTitle: 'KI ohne Big Tech',
    userDesc: 'Nutze leistungsstarke Sprachmodelle ohne deine Daten an zentralisierte Clouds zu senden. Community-betrieben, offen und privat.',
    userFeatures: [
      '10 ENI Willkommensbonus — sofort starten',
      'Wahl aus mehreren Modellen: Gemma, Phi, Llama',
      'Provider bewerten und Netzwerkqualität formen',
      'Kein Abo, Bezahlung pro Prompt',
      'Deine Daten bleiben im Netzwerk, nicht im Rechenzentrum',
    ],
    userCta: '10 ENI kostenlos →',
    forProviders: 'Für Provider',
    providerTitle: 'Deine GPU arbeitet für dich',
    providerDesc: 'Dein Gaming-PC verdient echten Wert, während du schläfst. Einmal einrichten, dauerhaft laufen lassen — alles in Docker, vollständig automatisiert.',
    providerFeatures: [
      'Läuft als Docker-Container — isoliert und sicher',
      'Erkennt deine GPU automatisch und empfiehlt Modelle',
      'Multi-Modell: 2–4 LLMs gleichzeitig auf einer GPU',
      'ENI pro Inferenz verdienen, Einnahmen in Echtzeit sehen',
      'Unterstützt Linux, macOS und Windows',
    ],
    providerCta: 'Provider werden →',
    tokenLabel: '// ENI Token',
    tokenTitle: 'Fair by design.\nPowered by ENI.',
    tokenSub: 'ENI ist der Token der Enigma fair hält — Nutzer werden nie ausgenutzt, Provider immer belohnt. Keine Mittelsmänner. Keine versteckten Gebühren. Echtes Gleichgewicht.',
    tf1Title: 'Faire Nutzung für User',
    tf1: 'Zahle nur was du nutzt. ENI kostet einen Bruchteil eines Cents pro Anfrage — mit täglich 10 ENI kostenlos geht niemandem das Budget aus. KI für alle.',
    tf2Title: 'Echte Belohnung für Provider',
    tf2: 'Jede Inferenz deiner GPU verdient ENI — automatisch, sofort, transparent. Je besser dein Node, desto mehr Jobs erhält er. Qualität wird belohnt.',
    tf3Title: 'Eingebautes Gleichgewicht',
    tf3: 'ENI schafft ein selbstregulierendes Gleichgewicht: steigt die Nachfrage, verdienen Provider mehr. Wächst das Angebot, sinken die Kosten für Nutzer.',
    tf4Title: 'Governance (demnächst)',
    tf4: 'ENI-Inhaber gestalten die Zukunft — Abstimmungen über Gebühren, Routing-Regeln und Protokoll-Upgrades. Das Netzwerk gehört seinen Teilnehmern.',
    archLabel: '// Architektur',
    archTitle: 'Für Skalierung gebaut',
    archSub: 'Interface-getriebene Architektur bedeutet: jede Komponente ist austauschbar — von SQLite zu Blockchain, von Round-Robin zu verteilten Schedulern.',
    archScalePath: 'Skalierungspfad: RegistryStore → etcd · Router → Distributed Scheduler · Ledger → Blockchain',
    apiLabel: '// API-Integrationen',
    apiTitle: 'Funktioniert mit\ndeinen Tools.',
    apiSub: 'Enigma spricht die Protokolle die deine Tools bereits nutzen — als OpenAI- oder Ollama-Endpoint einbinden ohne Code-Änderungen.',
    apiCode: `from openai import OpenAI

client = OpenAI(
    base_url="https://www.enigmanet.org/v1",
    api_key="enk_dein_key_hier",
)

response = client.chat.completions.create(
    model="phi3:mini",
    messages=[{"role": "user", "content": "Hallo!"}],
)
print(response.choices[0].message.content)`,
    apiFeature1: 'OpenAI-kompatibel  /v1/chat/completions',
    apiFeature1Desc: 'Cline, LangChain, n8n, Continue.dev, AnythingLLM, AutoGen — einfach Base URL tauschen',
    apiFeature2: 'Ollama-kompatibel  /api/generate + /api/chat',
    apiFeature2Desc: 'Open WebUI, Msty, Homebrew und alle Ollama-Clients — Host auf enigmanet.org setzen',
    apiFeature3: 'Anthropic Messages API + MCP  (geplant)',
    apiFeature3Desc: 'Claude Desktop, Cursor Agent-Modus und MCP-native Tools — demnächst verfügbar',
    apiCta: 'API Key erstellen →',
    ctaTitle: 'Werde Teil des Grids.',
    ctaSub: 'Beginne zu verdienen oder zu bauen — keine Einrichtungsgebühren, kein Lock-in.',
    ctaFree: '10 ENI kostenlos →',
    ctaNode: 'Provider-Node starten',
    ctaDash: 'Dashboard öffnen',
    navHow: 'So funktioniert es',
    navToken: 'ENI Token',
    navProviders: 'Provider',
    navDash: 'Dashboard',
    navStart: 'Loslegen',
    footerCopy: '© 2026 Enigma Network · Beta',
  },
} as const

type Lang = 'en' | 'de'

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>('en')
  const tx = t[lang]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --black: #04090f; --dark: #070e1a; --panel: #0b1524;
          --border: rgba(0,220,130,0.12); --green: #00dc82;
          --green-dim: rgba(0,220,130,0.15); --cyan: #00bfff;
          --white: #e8eef8; --muted: #4a5a72;
          --font-head: 'Syne', sans-serif; --font-body: 'DM Mono', monospace;
        }
        html { scroll-behavior: smooth; }
        body { background: var(--black); color: var(--white); font-family: var(--font-body); font-size: 15px; line-height: 1.6; overflow-x: hidden; }
        .grid-bg { position: fixed; inset: 0; z-index: 0; background-image: linear-gradient(rgba(0,220,130,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,220,130,0.04) 1px, transparent 1px); background-size: 48px 48px; pointer-events: none; }
        .grid-bg::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0,220,130,0.08) 0%, transparent 70%); }
        nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; padding: 18px 48px; background: rgba(4,9,15,0.7); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); }
        .nav-logo { font-family: var(--font-head); font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: var(--green); text-decoration: none; }
        .nav-logo span { color: var(--white); }
        .nav-links { display: flex; gap: 28px; align-items: center; }
        .nav-links a { color: var(--muted); text-decoration: none; font-size: 13px; letter-spacing: 0.5px; transition: color 0.2s; }
        .nav-links a:hover { color: var(--white); }
        .lang-toggle { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
        .lang-btn { padding: 6px 12px; font-family: var(--font-body); font-size: 12px; letter-spacing: 1px; cursor: pointer; border: none; transition: all 0.15s; background: transparent; color: var(--muted); }
        .lang-btn.active { background: var(--green); color: #000; font-weight: 500; }
        .lang-btn:not(.active):hover { color: var(--white); }
        .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 22px; border-radius: 6px; font-family: var(--font-body); font-size: 13px; font-weight: 500; text-decoration: none; transition: all 0.2s; cursor: pointer; border: none; }
        .btn-primary { background: var(--green); color: #000; }
        .btn-primary:hover { background: #00ff9a; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,220,130,0.3); }
        .btn-ghost { background: transparent; color: var(--white); border: 1px solid var(--border); }
        .btn-ghost:hover { border-color: var(--green); color: var(--green); }
        .btn-large { padding: 14px 32px; font-size: 15px; border-radius: 8px; }
        .hero { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 120px 24px 80px; }
        .hero-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; color: var(--green); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 36px; }
        .hero-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }
        .hero h1 { font-family: var(--font-head); font-size: clamp(52px,8vw,110px); font-weight: 800; line-height: 0.95; letter-spacing: -3px; max-width: 900px; margin-bottom: 28px; }
        .hero h1 em { font-style: normal; color: var(--green); display: block; }
        .hero-sub { font-size: 17px; color: var(--muted); max-width: 480px; line-height: 1.7; margin-bottom: 48px; }
        .hero-ctas { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
        .ticker-wrap { position: relative; z-index: 1; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); overflow: hidden; padding: 14px 0; background: rgba(0,220,130,0.03); }
        .ticker { display: flex; animation: ticker 30s linear infinite; width: max-content; }
        @keyframes ticker { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        .ticker-item { display: flex; align-items: center; gap: 10px; padding: 0 40px; font-size: 12px; color: var(--muted); letter-spacing: 2px; text-transform: uppercase; white-space: nowrap; }
        .ticker-item span { color: var(--green); font-weight: 500; }
        .ticker-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--green); opacity: 0.4; }
        section { position: relative; z-index: 1; }
        .container { max-width: 1100px; margin: 0 auto; padding: 0 32px; }
        .section-label { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: var(--green); margin-bottom: 16px; }
        .section-title { font-family: var(--font-head); font-size: clamp(36px,5vw,60px); font-weight: 800; line-height: 1.05; letter-spacing: -2px; margin-bottom: 20px; white-space: pre-line; }
        .section-sub { color: var(--muted); max-width: 520px; line-height: 1.7; }
        .stats { padding: 80px 0; border-bottom: 1px solid var(--border); }
        .stats-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .stat-cell { background: var(--panel); padding: 40px 32px; text-align: center; }
        .stat-num { font-family: var(--font-head); font-size: 52px; font-weight: 800; color: var(--green); letter-spacing: -2px; line-height: 1; display: block; }
        .stat-label { font-size: 12px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; margin-top: 8px; }
        .how { padding: 100px 0; }
        .steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 2px; margin-top: 64px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .step { background: var(--panel); padding: 40px 32px; }
        .step-num { font-family: var(--font-head); font-size: 64px; font-weight: 800; color: rgba(0,220,130,0.1); line-height: 1; margin-bottom: 20px; letter-spacing: -3px; }
        .step-icon { font-size: 28px; margin-bottom: 16px; display: block; }
        .step h3 { font-family: var(--font-head); font-size: 22px; font-weight: 700; margin-bottom: 12px; letter-spacing: -0.5px; }
        .step p { color: var(--muted); font-size: 14px; line-height: 1.7; }
        .split { padding: 80px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .split-panel { background: var(--panel); padding: 52px 48px; position: relative; overflow: hidden; }
        .split-panel::before { content: ''; position: absolute; top: -60px; right: -60px; width: 200px; height: 200px; border-radius: 50%; background: var(--green-dim); filter: blur(60px); pointer-events: none; }
        .split-panel.provider::before { background: rgba(0,191,255,0.1); }
        .panel-tag { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 24px; font-weight: 500; }
        .panel-tag.user { background: var(--green-dim); color: var(--green); }
        .panel-tag.provider { background: rgba(0,191,255,0.1); color: var(--cyan); }
        .split-panel h2 { font-family: var(--font-head); font-size: 36px; font-weight: 800; letter-spacing: -1.5px; margin-bottom: 16px; }
        .split-panel p { color: var(--muted); font-size: 14px; line-height: 1.8; margin-bottom: 32px; }
        .feature-list { list-style: none; display: flex; flex-direction: column; gap: 10px; margin-bottom: 36px; }
        .feature-list li { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--white); opacity: 0.8; }
        .feature-list li::before { content: '→'; color: var(--green); font-size: 14px; flex-shrink: 0; }
        .split-panel.provider .feature-list li::before { color: var(--cyan); }
        .token { padding: 100px 0; }
        .token-grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 48px; align-items: center; margin-top: 64px; }
        .token-visual { display: flex; align-items: center; justify-content: center; }
        .token-coin { width: 200px; height: 200px; border-radius: 50%; border: 2px solid var(--green); display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--green-dim); box-shadow: 0 0 60px rgba(0,220,130,0.2), inset 0 0 30px rgba(0,220,130,0.05); animation: float 4s ease-in-out infinite; }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        .token-coin .symbol { font-family: var(--font-head); font-size: 52px; font-weight: 800; color: var(--green); line-height: 1; }
        .token-coin .name { font-size: 11px; color: var(--muted); letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
        .token-features { display: flex; flex-direction: column; gap: 20px; }
        .token-feature { padding: 20px 24px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); transition: border-color 0.2s; }
        .token-feature:hover { border-color: var(--green); }
        .token-feature h4 { font-family: var(--font-head); font-size: 16px; font-weight: 700; margin-bottom: 4px; }
        .token-feature p { font-size: 13px; color: var(--muted); }
        .arch { padding: 80px 0; border-top: 1px solid var(--border); }
        .arch-diagram { margin-top: 60px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--panel); padding: 48px; font-size: 13px; }
        .arch-row { display: flex; gap: 16px; align-items: center; justify-content: center; flex-wrap: wrap; margin-bottom: 24px; }
        .arch-box { padding: 12px 20px; border-radius: 8px; border: 1px solid; text-align: center; }
        .arch-box.client { border-color: rgba(0,191,255,0.3); color: var(--cyan); background: rgba(0,191,255,0.05); }
        .arch-box.server { border-color: var(--border); color: var(--green); background: var(--green-dim); font-weight: 500; }
        .arch-box.node { border-color: rgba(255,165,0,0.3); color: #f0a040; background: rgba(255,165,0,0.05); }
        .arch-arrow { color: var(--muted); font-size: 18px; }
        .arch-label { font-size: 11px; color: var(--muted); text-align: center; letter-spacing: 1px; text-transform: uppercase; margin-top: 24px; }
        .cta { padding: 100px 0 120px; text-align: center; position: relative; }
        .cta::before { content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 600px; height: 300px; background: radial-gradient(ellipse, rgba(0,220,130,0.08) 0%, transparent 70%); pointer-events: none; }
        .cta h2 { font-family: var(--font-head); font-size: clamp(42px,6vw,72px); font-weight: 800; letter-spacing: -2.5px; line-height: 1; margin-bottom: 20px; }
        .cta p { color: var(--muted); font-size: 17px; margin-bottom: 48px; }
        .cta-btns { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
        footer { border-top: 1px solid var(--border); padding: 32px 0; position: relative; z-index: 1; }
        .footer-inner { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
        .footer-logo { font-family: var(--font-head); font-size: 16px; font-weight: 700; color: var(--green); }
        .footer-links { display: flex; gap: 24px; }
        .footer-links a { font-size: 12px; color: var(--muted); text-decoration: none; letter-spacing: 0.5px; }
        .footer-links a:hover { color: var(--white); }
        .footer-copy { font-size: 12px; color: var(--muted); }
        @media(max-width:768px){nav{padding:16px 20px}.nav-links{display:none}.hero{padding:100px 20px 60px}.stats-grid{grid-template-columns:1fr 1fr}.steps{grid-template-columns:1fr}.split-grid{grid-template-columns:1fr}.token-grid{grid-template-columns:1fr}.container{padding:0 20px}}
      `}</style>

      <div className="grid-bg" />

      <nav>
        <a href="/" className="nav-logo">ENI<span>GMA</span></a>
        <div className="nav-links">
          <a href="#how">{tx.navHow}</a>
          <a href="#token">{tx.navToken}</a>
          <a href="#for-providers">{tx.navProviders}</a>
          <a href="/dashboard">{tx.navDash}</a>
          <div className="lang-toggle">
            <button className={`lang-btn${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>EN</button>
            <button className={`lang-btn${lang === 'de' ? ' active' : ''}`} onClick={() => setLang('de')}>DE</button>
          </div>
          <Link href="/join/user" className="btn btn-primary">{tx.navStart}</Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge">{tx.badge}</div>
        <h1>{tx.heroH1a}<em>{tx.heroH1b}</em></h1>
        <p className="hero-sub">{tx.heroSub}</p>
        <div className="hero-ctas">
          <Link href="/join/user" className="btn btn-primary btn-large">{tx.ctaUser}</Link>
          <Link href="/join/provider" className="btn btn-ghost btn-large">{tx.ctaProvider}</Link>
        </div>
      </section>

      <div className="ticker-wrap">
        <div className="ticker">
          {[...Array(2)].map((_, i) => (
            <div key={i} style={{ display: 'flex' }}>
              {['Decentralized','AI Compute','GPU Sharing','ENI Tokens','Proof-of-Compute','Open Network','LLM Inference','Community-Owned','No Cloud'].map((label, j) => (
                <div key={j} className="ticker-item"><span>{label}</span><span className="ticker-dot" /></div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section className="stats">
        <div className="container">
          <div className="stats-grid">
            {[['∞', tx.stat1],['1.0', tx.stat2],['10', tx.stat3],['0%', tx.stat4]].map(([n, l]) => (
              <div key={l} className="stat-cell">
                <span className="stat-num">{n}</span>
                <div className="stat-label">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="how" id="how">
        <div className="container">
          <div className="section-label">{tx.howLabel}</div>
          <div className="section-title">{tx.howTitle}</div>
          <p className="section-sub">{tx.howSub}</p>
          <div className="steps">
            {[
              { n: '01', icon: '👤', title: tx.step1Title, body: tx.step1 },
              { n: '02', icon: '⚡', title: tx.step2Title, body: tx.step2 },
              { n: '03', icon: '💰', title: tx.step3Title, body: tx.step3 },
            ].map(s => (
              <div key={s.n} className="step">
                <div className="step-num">{s.n}</div>
                <span className="step-icon">{s.icon}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="split" id="for-providers">
        <div className="container">
          <div className="split-grid">
            <div className="split-panel">
              <span className="panel-tag user">{tx.forUsers}</span>
              <h2>{tx.userTitle}</h2>
              <p>{tx.userDesc}</p>
              <ul className="feature-list">{tx.userFeatures.map(f => <li key={f}>{f}</li>)}</ul>
              <Link href="/join/user" className="btn btn-primary">{tx.userCta}</Link>
            </div>
            <div className="split-panel provider">
              <span className="panel-tag provider">{tx.forProviders}</span>
              <h2>{tx.providerTitle}</h2>
              <p>{tx.providerDesc}</p>
              <ul className="feature-list">{tx.providerFeatures.map(f => <li key={f}>{f}</li>)}</ul>
              <Link href="/join/provider" className="btn btn-ghost" style={{ borderColor: 'rgba(0,191,255,0.3)', color: 'var(--cyan)' }}>{tx.providerCta}</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="how" id="api" style={{ background: 'var(--dark)' }}>
        <div className="container">
          <div className="section-label">{tx.apiLabel}</div>
          <div className="section-title" style={{ whiteSpace: 'pre-line' }}>{tx.apiTitle}</div>
          <p className="section-sub">{tx.apiSub}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', alignItems: 'start', marginTop: '48px' }}>
            <div>
              <pre style={{ background: '#070e1a', border: '1px solid rgba(0,220,130,0.15)', borderRadius: '12px', padding: '24px', fontSize: '13px', color: '#a0c4a0', overflowX: 'auto', lineHeight: '1.7' }}>{tx.apiCode}</pre>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {[
                [tx.apiFeature1, tx.apiFeature1Desc, 'var(--green)'],
                [tx.apiFeature2, tx.apiFeature2Desc, 'var(--cyan)'],
                [tx.apiFeature3, tx.apiFeature3Desc, '#f5a623'],
              ].map(([title, desc, color]) => (
                <div key={title as string} style={{ borderLeft: `2px solid ${color}`, paddingLeft: '16px' }}>
                  <p style={{ fontFamily: 'var(--font-head)', fontSize: '15px', fontWeight: 700, color: color as string, marginBottom: '4px' }}>{title}</p>
                  <p style={{ color: 'var(--muted)', fontSize: '13px' }}>{desc}</p>
                </div>
              ))}
              <Link href="/profile" className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: '8px' }}>{tx.apiCta}</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="token" id="token">
        <div className="container">
          <div className="section-label">{tx.tokenLabel}</div>
          <div className="section-title">{tx.tokenTitle}</div>
          <p className="section-sub">{tx.tokenSub}</p>
          <div className="token-grid">
            <div className="token-visual">
              <div className="token-coin">
                <span className="symbol">ENI</span>
                <span className="name">Token</span>
              </div>
            </div>
            <div className="token-features">
              {[
                [tx.tf1Title, tx.tf1],[tx.tf2Title, tx.tf2],
                [tx.tf3Title, tx.tf3],[tx.tf4Title, tx.tf4],
              ].map(([h, p]) => (
                <div key={h} className="token-feature"><h4>{h}</h4><p>{p}</p></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="arch">
        <div className="container">
          <div className="section-label">{tx.archLabel}</div>
          <div className="section-title">{tx.archTitle}</div>
          <p className="section-sub">{tx.archSub}</p>
          <div className="arch-diagram">
            <div className="arch-row">
              {['Web App','CLI','API'].map(c => <div key={c} className="arch-box client">{c}</div>)}
            </div>
            <div className="arch-row"><span className="arch-arrow">↓</span></div>
            <div className="arch-row">
              <div className="arch-box server" style={{ padding: '20px 40px', fontSize: '14px' }}>Coordinator · Scored Router · ENI Ledger</div>
            </div>
            <div className="arch-row" style={{ gap: '32px' }}>
              <span className="arch-arrow">↙</span><span className="arch-arrow">↓</span><span className="arch-arrow">↘</span>
            </div>
            <div className="arch-row">
              {['Provider Node\nOllama / gemma3:12b','Provider Node\nOllama / gemma3:4b','Provider Node\nllama.cpp / phi3'].map(n => (
                <div key={n} className="arch-box node" style={{ whiteSpace: 'pre', fontSize: '12px' }}>{n}</div>
              ))}
            </div>
            <div className="arch-label">{tx.archScalePath}</div>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="container">
          <h2>{tx.ctaTitle}</h2>
          <p>{tx.ctaSub}</p>
          <div className="cta-btns">
            <Link href="/join/user" className="btn btn-primary btn-large">{tx.ctaFree}</Link>
            <Link href="/join/provider" className="btn btn-ghost btn-large">{tx.ctaNode}</Link>
            <a href="/dashboard" className="btn btn-ghost btn-large">{tx.ctaDash}</a>
          </div>
        </div>
      </section>

      <footer>
        <div className="container">
          <div className="footer-inner">
            <span className="footer-logo">ENIGMA</span>
            <div className="footer-links">
              <a href="#how">{tx.navHow}</a>
              <a href="#token">{tx.navToken}</a>
              <a href="/dashboard">{tx.navDash}</a>
              <a href="/join/provider">{tx.navProviders}</a>
            </div>
            <span className="footer-copy">{tx.footerCopy}</span>
          </div>
        </div>
      </footer>
    </>
  )
}
