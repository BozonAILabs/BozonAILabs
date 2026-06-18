import './style.css'
import { initShaderBackground } from './shader-background'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="shader-bg"></canvas>
  <nav class="nav">
    <div class="nav-logo">
      <img src="/bozon-logo.png" alt="Bozon AI Labs" class="nav-logo-img" />
      Bozon AI Labs
    </div>
<a href="/contact" class="nav-cta">Get in Touch</a>
  </nav>

  <section class="hero">
<h1>
      Building <span class="gradient">AI-native</span> solutions<br />
      for real-world problems
    </h1>
  </section>

  <section class="section" id="products">
    <div class="section-label">Products</div>
    <h2>What we're building</h2>

    <div class="products-grid">
      <div class="product-card">
        <img src="/12thpass-logo.png" alt="12thPass Classroom" class="product-logo" />
        <h3>12thPass Classroom</h3>
        <p>
          A learning management system for Indian schools with AI-powered
          exam creation, class management, and student performance analytics.
        </p>
      </div>
      <a href="https://www.12thpass.ai/" target="_blank" rel="noopener noreferrer" class="product-card product-card-link">
        <img src="/12thpass-logo.png" alt="12thPass" class="product-logo" />
        <h3>12thPass <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; opacity: 0.6;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></h3>
        <p>
          An agentic AI learning system that acts as a personal mentor for
          every student preparing for India's competitive exams. Adapts to
          each learner's pace, anticipates needs, and brings clarity to
          every step of preparation.
        </p>
      </a>
      <a href="https://munsi.ai/" target="_blank" rel="noopener noreferrer" class="product-card product-card-link">
        <div class="product-wordmark" aria-hidden="true">munsi_</div>
        <h3>Munsi <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; opacity: 0.6;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></h3>
        <p>
          A WhatsApp-first business records product that keeps accounts,
          stock, files, team updates, and reminders structured from everyday
          messages.
        </p>
      </a>
    </div>
  </section>

  <footer class="footer">
    <p>&copy; 2026 Bozon AI Labs. All rights reserved.</p>
    <ul class="footer-links">
      <li><a href="/privacy">Privacy</a></li>
      <li><a href="/terms">Terms</a></li>
      <li><a href="/contact">Contact</a></li>
    </ul>
  </footer>
`

const shaderCanvas = document.querySelector<HTMLCanvasElement>('#shader-bg')
if (shaderCanvas) {
  initShaderBackground(shaderCanvas)
}
