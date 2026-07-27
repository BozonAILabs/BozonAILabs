/*
THESIS: Bozon makes high-standard software delivery attainable for growing businesses and refuses the generic agency capability grid.
OWN-WORLD: Forest-black surfaces, exact off-white type, and one mint-to-deep-green point field carry the entire experience.
STORY: A buyer understands the promise, experiences quality, speed, and price as three distinct commitments, sees shipped products, and contacts Bozon.
FIRST VIEWPORT: The fixed logo-only navigation sits above a concise category thesis and an architectural point field rising from below.
FORM: The user-pinned direction is a three-state fixed-canvas narrative. A concept seed is not applicable to this precisely specified extension.
*/

import './style.css'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { initShaderBackground } from './shader-background'

gsap.registerPlugin(ScrollTrigger)

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <nav class="nav" aria-label="Primary navigation">
    <a href="/" class="nav-logo" aria-label="Bozon AI Labs home">
      <img src="/bozon-logo.png" alt="" class="nav-logo-img" />
    </a>
    <a href="mailto:info@bozonailabs.com" class="nav-cta">Get in Touch</a>
  </nav>

  <main>
    <div class="narrative">
      <div class="narrative-visual" aria-hidden="true">
        <canvas id="shader-bg"></canvas>
      </div>

      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-content">
          <h1 id="hero-title">
            <span class="hero-line">A <span class="hero-emphasis">new standard</span> for software delivery.</span>
          </h1>
        </div>
      </section>

      <section class="services-story" aria-label="Software solutions">
        <div class="services-stage">
          <p class="services-label">Software solutions</p>
          <div class="services-copy" aria-live="off">
            <article class="service-state service-state-quality">
              <h2>Built to a high standard.</h2>
              <p>Careful product thinking, refined interfaces, and dependable engineering.</p>
            </article>
            <article class="service-state service-state-speed">
              <h2>Delivered at speed.</h2>
              <p>Focused execution keeps the work moving from brief to working software.</p>
            </article>
            <article class="service-state service-state-price">
              <h2>Priced for growing businesses.</h2>
              <p>Serious software delivery without the cost structure of a large consultancy.</p>
            </article>
          </div>
          <div class="services-progress" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
        </div>
      </section>
    </div>

    <section class="section" id="products">
      <header class="section-header">
        <div class="section-label">Products</div>
        <h2>What we've built</h2>
      </header>

      <div class="products-grid" role="region" aria-label="Product showcase, scroll horizontally to browse" tabindex="0">
        <a href="https://www.12thpass.ai/" target="_blank" rel="noopener noreferrer" class="product-card product-card-link">
          <img src="/12thpass-logo.png" alt="12thPass" class="product-logo" />
          <div class="product-copy">
            <h3>12thPass <svg class="external-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span class="sr-only"> (opens in a new tab)</span></h3>
            <p>
              An agentic AI learning system that acts as a personal mentor for
              every student preparing for India's competitive exams. Adapts to
              each learner's pace, anticipates needs, and brings clarity to
              every step of preparation.
            </p>
          </div>
        </a>
        <a href="https://munsi.ai/" target="_blank" rel="noopener noreferrer" class="product-card product-card-link product-card-munsi">
          <div class="product-wordmark" aria-hidden="true">munsi_</div>
          <div class="product-copy">
            <h3>Munsi <svg class="external-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span class="sr-only"> (opens in a new tab)</span></h3>
            <p>
              A WhatsApp-first business records product that keeps accounts,
              stock, files, team updates, and reminders structured from everyday
              messages.
            </p>
          </div>
        </a>
      </div>
    </section>
  </main>

  <footer class="footer">
    <p>&copy; 2026 Bozon AI Labs. All rights reserved.</p>
    <ul class="footer-links">
      <li><a href="/privacy">Privacy</a></li>
      <li><a href="/terms">Terms</a></li>
      <li><a href="mailto:info@bozonailabs.com">Contact</a></li>
    </ul>
  </footer>
`

const shaderCanvas = document.querySelector<HTMLCanvasElement>('#shader-bg')
const shader = shaderCanvas ? initShaderBackground(shaderCanvas) : null
const motionMedia = gsap.matchMedia()

const showStaticState = (): void => {
  shader?.setScene(0)
  gsap.set(
    '.nav, .hero-content, .hero h1, .services-label, .service-state, .services-progress, .section-header, .product-card, .footer',
    { clearProps: 'all' },
  )
}

motionMedia.add(
  {
    motionOK: '(prefers-reduced-motion: no-preference)',
    isDesktop: '(min-width: 769px)',
  },
  (context) => {
    const { motionOK, isDesktop } = context.conditions as {
      motionOK: boolean
      isDesktop: boolean
    }

    if (!motionOK) {
      showStaticState()
      return
    }

    const intro = gsap.timeline({ defaults: { ease: 'expo.out' } })
    intro
      .fromTo(
        '.nav',
        { autoAlpha: 0, y: -18 },
        { autoAlpha: 1, y: 0, duration: 1.05 },
        0.06,
      )
      .fromTo(
        '.hero-line',
        { autoAlpha: 0, yPercent: 115, clipPath: 'inset(0 0 100% 0)' },
        {
          autoAlpha: 1,
          yPercent: 0,
          clipPath: 'inset(0 0 0% 0)',
          duration: 1.15,
          stagger: 0.09,
        },
        0.16,
      )
      .fromTo(
        '.narrative-visual',
        { autoAlpha: 0, scale: 1.035 },
        { autoAlpha: 1, scale: 1, duration: 1.7 },
        0.22,
      )

    const shaderScene = { value: 0 }
    const heroTimeline = gsap.timeline({
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: isDesktop ? 0.9 : 0.5,
      },
    })
    heroTimeline
      .to(
        shaderScene,
        {
          value: 1,
          duration: 1,
          ease: 'none',
          onUpdate: () => shader?.setScene(shaderScene.value),
        },
        0,
      )
      .to(
        '.hero-content',
        { yPercent: -12, scale: 0.975, duration: 0.72, ease: 'none' },
        0.28,
      )

    const states = gsap.utils.toArray<HTMLElement>('.service-state')
    const progressMarks = gsap.utils.toArray<HTMLElement>('.services-progress span')
    gsap.set(states, { opacity: 0, y: 22, clipPath: 'inset(0 0 14% 0)' })
    gsap.set(states[0], { opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)' })
    gsap.set(progressMarks, { scaleX: 0.22, transformOrigin: 'left center' })
    gsap.set(progressMarks[0], { scaleX: 1 })

    const storyTimeline = gsap.timeline({
      scrollTrigger: {
        trigger: '.services-story',
        start: 'top top',
        end: 'bottom bottom',
        scrub: isDesktop ? 0.9 : 0.55,
        invalidateOnRefresh: true,
      },
    })

    storyTimeline
      .fromTo(
        shaderScene,
        { value: 1 },
        {
          value: 3,
          duration: 1,
          ease: 'none',
          immediateRender: false,
          onUpdate: () => shader?.setScene(shaderScene.value),
        },
        0,
      )
      .to(states[0], { opacity: 0, y: -18, clipPath: 'inset(0 0 16% 0)', duration: 0.1, ease: 'none' }, 0.25)
      .to(progressMarks[0], { scaleX: 0.22, duration: 0.08, ease: 'none' }, 0.26)
      .fromTo(
        states[1],
        { opacity: 0, y: 22, clipPath: 'inset(0 0 16% 0)' },
        { opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 0.11, ease: 'none', immediateRender: false },
        0.3,
      )
      .to(progressMarks[1], { scaleX: 1, duration: 0.1, ease: 'none' }, 0.3)
      .to(states[1], { opacity: 0, y: -18, clipPath: 'inset(0 0 16% 0)', duration: 0.1, ease: 'none' }, 0.59)
      .to(progressMarks[1], { scaleX: 0.22, duration: 0.08, ease: 'none' }, 0.6)
      .fromTo(
        states[2],
        { opacity: 0, y: 22, clipPath: 'inset(0 0 16% 0)' },
        { opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 0.11, ease: 'none', immediateRender: false },
        0.64,
      )
      .to(progressMarks[2], { scaleX: 1, duration: 0.1, ease: 'none' }, 0.64)

    const productsIntro = gsap.timeline({
      scrollTrigger: {
        trigger: '.section-header',
        start: 'top 82%',
        once: true,
      },
      defaults: { ease: 'expo.out' },
    })

    productsIntro
      .fromTo('.section-label', { x: -18 }, { x: 0, duration: 0.8 })
      .fromTo(
        '.section-header h2',
        { y: 28, clipPath: 'inset(0 0 100% 0)' },
        { y: 0, clipPath: 'inset(0 0 0% 0)', duration: 1 },
        0.1,
      )

    const panelStarts = isDesktop
      ? [
          { x: -34, y: 0, scale: 0.985 },
          { x: 34, y: 0, scale: 0.985 },
        ]
      : [
          { x: -22, y: 0, scale: 0.99 },
          { x: 22, y: 0, scale: 0.99 },
        ]

    gsap.utils.toArray<HTMLElement>('.product-card').forEach((panel, index) => {
      gsap.fromTo(
        panel,
        { ...panelStarts[index] },
        {
          x: 0,
          y: 0,
          scale: 1,
          duration: 1.05,
          ease: 'expo.out',
          scrollTrigger: {
            trigger: panel,
            start: 'top 96%',
            once: true,
          },
        },
      )
    })

    const footerTween = gsap.fromTo(
      '.footer',
      { y: 18 },
      {
        y: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: '.footer',
          start: 'top bottom',
          end: 'top 78%',
          scrub: 0.7,
        },
      },
    )

    const hoverCleanups = gsap.utils
      .toArray<HTMLAnchorElement>('.product-card-link')
      .map((panel) => {
        const icon = panel.querySelector<SVGElement>('.external-icon')
        const enter = (): void => {
          if (icon) {
            gsap.to(icon, { x: 2, y: -2, duration: 0.45, ease: 'expo.out', overwrite: 'auto' })
          }
        }
        const leave = (): void => {
          if (icon) {
            gsap.to(icon, { x: 0, y: 0, duration: 0.55, ease: 'expo.out', overwrite: 'auto' })
          }
        }

        panel.addEventListener('pointerenter', enter)
        panel.addEventListener('pointerleave', leave)
        panel.addEventListener('focus', enter)
        panel.addEventListener('blur', leave)

        return (): void => {
          panel.removeEventListener('pointerenter', enter)
          panel.removeEventListener('pointerleave', leave)
          panel.removeEventListener('focus', enter)
          panel.removeEventListener('blur', leave)
        }
      })

    return () => {
      intro.kill()
      heroTimeline.kill()
      storyTimeline.kill()
      productsIntro.kill()
      footerTween.kill()
      hoverCleanups.forEach((cleanup) => cleanup())
    }
  },
)

document.fonts.ready.then(() => ScrollTrigger.refresh())

window.addEventListener(
  'pagehide',
  () => {
    motionMedia.revert()
    shader?.destroy()
  },
  { once: true },
)
