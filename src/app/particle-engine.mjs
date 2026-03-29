// ==========================================================
//  Particle Engine — sim-canvas particle flow visualization
//  Sub-AC 4a: Canvas element setup, Particle class (position,
//             velocity, color, target-bucket), RAF loop ≥30fps,
//             static bucket layout (5 buckets) with hit-detection
//  Sub-AC 6e: Visual polish — role-based color coding, motion
//             trails, styled canvas overlays
//  PRD §12.3
// ==========================================================

/** Archetype-to-color map (matches dashboard.js ARCHETYPE_COLORS) */
export const ARCHETYPE_COLORS = {
  price_sensitive:      '#38bdf8',  // sky-400
  value_seeker:         '#34d399',  // emerald-400
  premium_quality:      '#fbbf24',  // amber-400
  trust_first:          '#a78bfa',  // violet-400
  aesthetics_first:     '#f472b6',  // pink-400
  urgency_buyer:        '#fb923c',  // orange-400
  promo_hunter:         '#f87171',  // red-400
  gift_or_family_buyer: '#c084fc',  // purple-400
};

/**
 * Product/market role color map — used for role-based particle color coding (Sub-AC 6e).
 * Maps productId to its display color. Particles flowing to 'our_product' are
 * the "seller role" (blue); all others are "market role" (competitor colors).
 */
export const PRODUCT_COLORS = {
  our_product:  '#2563eb',   // seller role — deep blue
  competitor_a: '#dc2626',   // market role — red
  competitor_b: '#ea580c',   // market role — orange
  competitor_c: '#ca8a04',   // market role — amber
  pass:         '#6b7280',   // market role — gray
};

/** The seller's own product ID — particles going here are "seller role" */
export const SELLER_PRODUCT_ID = 'our_product';

/**
 * Static bucket definitions for the 5 destination buckets (4 products + pass).
 * defaultRelX / defaultRelY are fractions of canvas CSS dimensions,
 * used as fallback when no position has been registered via setProductPos().
 * hitRadius is the spatial collision-detection radius in CSS pixels.
 */
export const BUCKET_DEFS = [
  { id: 'our_product',  color: '#2563eb', label: '트리클리닉', defaultRelX: 0.50, defaultRelY: 0.88, hitRadius: 30 },
  { id: 'competitor_a', color: '#dc2626', label: '경쟁A',    defaultRelX: 0.25, defaultRelY: 0.88, hitRadius: 26 },
  { id: 'competitor_b', color: '#ea580c', label: '경쟁B',    defaultRelX: 0.37, defaultRelY: 0.88, hitRadius: 26 },
  { id: 'competitor_c', color: '#ca8a04', label: '경쟁C',    defaultRelX: 0.63, defaultRelY: 0.88, hitRadius: 26 },
  { id: 'pass',         color: '#6b7280', label: '패스',     defaultRelX: 0.75, defaultRelY: 0.88, hitRadius: 22 },
];

/** Particle animation duration in ms (2.2s for clearly visible flight path) */
const PARTICLE_DURATION_MS = 2200;

/** Object pool size — supports 800 concurrent + headroom */
const POOL_SIZE = 1200;

/**
 * Maximum number of trail positions per particle — Sub-AC 6e.
 * Each frame records one {x, y} sample; kept to last TRAIL_MAX.
 * Rendered as fading ghost circles behind the particle.
 */
const TRAIL_MAX = 6;

// ── Particle object (reused from pool) ──────────────────────

class Particle {
  constructor() {
    this.active       = false;
    this.startX       = 0;
    this.startY       = 0;
    this.endX         = 0;
    this.endY         = 0;
    this.x            = 0;
    this.y            = 0;
    /** Constant velocity x in CSS px/ms (computed at spawn time from start→end / duration) */
    this.vx           = 0;
    /** Constant velocity y in CSS px/ms (computed at spawn time from start→end / duration) */
    this.vy           = 0;
    this.elapsed      = 0;   // ms elapsed since spawn
    this.color        = '#94a3b8';
    this.radius       = 3;
    /** 🦞 emoji displayed on the canvas — Sub-AC 6b */
    this.emoji        = '🦞';
    /** Target bucket id string (e.g. 'our_product', 'pass') — null for coordinate-based spawns */
    this.targetBucket = null;

    // ── Sub-AC 6e: Visual polish fields ──────────────────────────────────────
    /**
     * Seller/market role — 'seller' when going to our_product, 'market' otherwise.
     * Drives role-based color coding: seller particles get a blue glow ring;
     * market particles use only the archetype color.
     */
    this.role         = 'market';
    /**
     * Target product color — color of the destination bucket (from PRODUCT_COLORS).
     * Used for the role-ring halo behind the emoji.
     */
    this.targetColor  = '#6b7280';
    /**
     * Motion trail history — array of {x, y} positions from previous frames.
     * Limited to TRAIL_MAX entries (oldest at index 0, newest at end).
     * Rendered as fading ghost circles behind the particle.
     */
    this.trail        = [];
  }
}

// ── ParticleEngine ──────────────────────────────────────────

export class ParticleEngine {
  /**
   * @param {HTMLCanvasElement} canvas  The Canvas 2D element to draw on
   */
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');

    // Pre-allocate particle pool
    this.pool    = Array.from({ length: POOL_SIZE }, () => new Particle());

    // RAF loop state
    this.running   = false;
    this.rafId     = null;
    this.lastTime  = null;

    // Logical CSS dimensions (updated by resize())
    this._cssW = canvas.clientWidth  || 600;
    this._cssH = canvas.clientHeight || 400;

    // FPS tracking (rolling over ~0.5s window)
    this._fpsFrames    = 0;
    this._fpsWindowMs  = 0;
    this._fpsPrevTs    = null;
    /** @type {number|null} Latest measured FPS (null until first reading) */
    this.fps = null;

    this._tick = this._tick.bind(this);

    // ── Frozen state flag (Sub-AC 6d) ───────────────────────
    // Set to true by freeze() on simulation_complete; reset on next start()
    this._frozen = false;

    // ── Node position registry ──────────────────────────────
    // Stores latest {x, y} for each archetype/product node ID.
    // Updated every RAF frame by the force-graph tick via setArchPos(),
    // and once at init time for product nodes via setProductPos().
    /** @type {Map<string, {x: number, y: number}>} */
    this._nodePos = new Map();

    // ── Bucket registry ─────────────────────────────────────
    // Stores active bucket data for hit-detection and canvas rendering.
    // Populated by initBuckets() and updated whenever setProductPos() is called.
    /** @type {Map<string, {id: string, x: number, y: number, color: string, label: string, hitRadius: number}>} */
    this._buckets = new Map();

    // ── SVG emoji group — Sub-AC 6b ─────────────────────────
    // When set, each spawned particle also creates a <text>🦞</text> SVG element
    // inside this group. This makes the emoji visible in the DOM for Playwright.
    // Set via setEmojiGroup() after the SVG is ready in the DOM.
    /** @type {SVGGElement|null} */
    this._emojiGroup = null;
  }

  // ── Bucket layout ─────────────────────────────────────────

  /**
   * Initialize the 5 static bucket positions from BUCKET_DEFS.
   * Positions buckets using defaultRelX/defaultRelY fractions of canvas dimensions
   * as fallbacks; if a real SVG node position has already been registered via
   * setProductPos(), that position is used instead.
   *
   * Call this after resize() so bucket hit zones remain accurate.
   *
   * @param {number} [cssWidth]   Canvas CSS width  (defaults to this._cssW)
   * @param {number} [cssHeight]  Canvas CSS height (defaults to this._cssH)
   */
  initBuckets(cssWidth, cssHeight) {
    const w = cssWidth  != null ? cssWidth  : this._cssW;
    const h = cssHeight != null ? cssHeight : this._cssH;
    for (const def of BUCKET_DEFS) {
      // Prefer the real SVG node position if it's been registered
      const nodePos = this._nodePos.get(def.id);
      const x = nodePos ? nodePos.x : def.defaultRelX * w;
      const y = nodePos ? nodePos.y : def.defaultRelY * h;
      this._buckets.set(def.id, {
        id:        def.id,
        x,
        y,
        color:     def.color,
        label:     def.label,
        hitRadius: def.hitRadius,
      });
    }
  }

  // ── Node position registry ───────────────────────────────

  /**
   * Update the stored position of an archetype node.
   * Called every RAF frame from the force-graph tick loop.
   * @param {string} archetypeId
   * @param {number} x
   * @param {number} y
   */
  setArchPos(archetypeId, x, y) {
    this._nodePos.set(archetypeId, { x, y });
  }

  /**
   * Update the stored position of a product node.
   * Also refreshes the bucket registry entry for this product (if it is a known bucket).
   * Called once after layout (products are fixed).
   * @param {string} productId
   * @param {number} x
   * @param {number} y
   */
  setProductPos(productId, x, y) {
    this._nodePos.set(productId, { x, y });
    // Keep bucket registry in sync for hit-detection
    const existing = this._buckets.get(productId);
    if (existing) {
      existing.x = x;
      existing.y = y;
    } else {
      // Auto-register if this productId matches a BUCKET_DEF
      const def = BUCKET_DEFS.find((d) => d.id === productId);
      if (def) {
        this._buckets.set(productId, {
          id:        productId,
          x,
          y,
          color:     def.color,
          label:     def.label,
          hitRadius: def.hitRadius,
        });
      }
    }
  }

  /**
   * Alias for setProductPos — matches the `setProdPos` call in the force-graph layout().
   * @param {string} productId
   * @param {number} x
   * @param {number} y
   */
  setProdPos(productId, x, y) {
    this.setProductPos(productId, x, y);
  }

  /**
   * Set the SVG <g> element that receives DOM-visible 🦞 emoji particles.
   * Called once during init from dashboard.js after the SVG is ready.
   * When set, every call to _spawnAt() creates a transient <text>🦞</text>
   * element inside this group (animated via CSS transition) so Playwright
   * can detect the emoji via textContent checks on the sim-canvas SVG.
   *
   * @param {SVGGElement} g  The <g id="sim-emoji-particles"> element
   */
  setEmojiGroup(g) {
    this._emojiGroup = g;
  }

  /**
   * Spawn a particle that travels from an archetype node to a product node.
   *
   * Supports two call signatures:
   *
   *   1. ID-based (primary):  spawn(archetypeId, productId)
   *      Looks up {x,y} from the internal _nodePos registry.
   *      Used by dashboard.js on each agent_decision SSE event.
   *
   *   2. Coordinate-based (legacy / benchmark):
   *         spawn(srcX, srcY, dstX, dstY, archetypeId)
   *      Explicit float coordinates — used by playwright-particle-bench.spec.mjs
   *      and the runPerfBench() method.
   *
   * @param {string|number} archetypeIdOrSrcX
   * @param {string|number} productIdOrSrcY
   * @param {number}        [dstX]
   * @param {number}        [dstY]
   * @param {string}        [archetypeIdForColor]
   * @returns {Particle|null}
   */
  spawn(archetypeIdOrSrcX, productIdOrSrcY, dstX, dstY, archetypeIdForColor) {
    // ── Coordinate-based API (legacy / benchmark) ──────────────────────────
    // Detected when the first argument is a number (an explicit x coordinate).
    if (typeof archetypeIdOrSrcX === 'number') {
      const srcX     = archetypeIdOrSrcX;
      const srcY     = /** @type {number} */ (productIdOrSrcY);
      const colorKey = archetypeIdForColor ?? 'price_sensitive';
      return this._spawnAt(srcX, srcY, dstX ?? 0, dstY ?? 0, colorKey);
    }

    // ── ID-based API (primary) ─────────────────────────────────────────────
    const archetypeId = archetypeIdOrSrcX;
    const productId   = /** @type {string} */ (productIdOrSrcY);
    const src = this._nodePos.get(archetypeId);
    const dst = this._nodePos.get(productId);
    if (!src || !dst) return null;
    return this._spawnAt(src.x, src.y, dst.x, dst.y, archetypeId, productId);
  }

  /**
   * Spawn a particle for an agent_decision SSE event.
   *
   * Sub-AC 6b update: particles spawn from the LEFT spawn area (x≈5% of canvas
   * width, random y in middle band) and flow to the right-side product bucket.
   * This creates the streaming-from-left visual effect described in PRD §12.3.
   *
   * Backward-compat contract (verified by unit tests):
   *  - Returns null when archetypeId is not registered (so dashboard.js
   *    knows the position isn't ready yet — same semantics as before)
   *  - Returns non-null Particle when both archetype AND product are registered
   *
   * @param {string} archetypeId  Key in ARCHETYPE_COLORS / _nodePos registry
   * @param {string} productId    One of our_product | competitor_a | competitor_b | competitor_c | pass
   * @returns {Particle|null}
   */
  spawnForAgent(archetypeId, productId) {
    // Require archetype to be registered — return null if missing (test contract)
    if (!this._nodePos.has(archetypeId)) return null;
    const dst = this._nodePos.get(productId);
    if (!dst) return null;
    // Spawn from archetype node position (±5px random offset for visual spread)
    const src = this._nodePos.get(archetypeId);
    const srcX = src.x + (Math.random() - 0.5) * 10;
    const srcY = src.y + (Math.random() - 0.5) * 10;
    return this._spawnAt(srcX, srcY, dst.x, dst.y, archetypeId, productId);
  }

  // ── Canvas sizing ────────────────────────────────────────

  /**
   * Resize the canvas to match its container, accounting for device pixel ratio.
   * Call whenever the container dimensions change.
   * @param {number} cssWidth   CSS logical width in pixels
   * @param {number} cssHeight  CSS logical height in pixels
   */
  resize(cssWidth, cssHeight) {
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    this._cssW = cssWidth;
    this._cssH = cssHeight;
    // Physical pixel size
    this.canvas.width  = Math.round(cssWidth  * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    // CSS size stays the same — scaling is done via setTransform
    this.canvas.style.width  = cssWidth  + 'px';
    this.canvas.style.height = cssHeight + 'px';
    // Scale context so all draw calls use CSS pixel coords
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Refresh bucket default positions so hit zones match new canvas size
    if (this._buckets.size > 0) this.initBuckets(cssWidth, cssHeight);
  }

  // ── Pool management ──────────────────────────────────────

  /**
   * Low-level spawn: create a particle from explicit coordinates.
   * Used internally by spawn() and runPerfBench().
   * @param {number} srcX
   * @param {number} srcY
   * @param {number} dstX
   * @param {number} dstY
   * @param {string} archetypeId     Key in ARCHETYPE_COLORS (sets particle color)
   * @param {string} [targetBucketId]  Target bucket id for hit-detection (optional)
   * @returns {Particle|null}  The activated particle, or null if pool is full
   */
  _spawnAt(srcX, srcY, dstX, dstY, archetypeId, targetBucketId) {
    for (const p of this.pool) {
      if (p.active) continue;
      p.active        = true;
      p.startX        = srcX;
      p.startY        = srcY;
      p.endX          = dstX;
      p.endY          = dstY;
      p.x             = srcX;
      p.y             = srcY;
      // Constant velocity (px/ms) for the 0.2s linear journey
      p.vx            = (dstX - srcX) / PARTICLE_DURATION_MS;
      p.vy            = (dstY - srcY) / PARTICLE_DURATION_MS;
      p.elapsed       = 0;
      p.color         = ARCHETYPE_COLORS[archetypeId] ?? '#94a3b8';
      // Slight size variation for visual interest
      p.radius        = 2 + Math.random() * 2;
      // 🦞 emoji particle label — Sub-AC 6b
      p.emoji         = '🦞';
      // Target bucket for spatial hit-detection (null for coordinate-based spawns)
      p.targetBucket  = targetBucketId ?? null;

      // ── Sub-AC 6e: role-based color coding ───────────────────────────────
      // 'seller' role = going to our_product (buyer chose us — blue halo)
      // 'market' role = going to competitor or pass (archetype color only)
      p.role          = targetBucketId === SELLER_PRODUCT_ID ? 'seller' : 'market';
      p.targetColor   = PRODUCT_COLORS[targetBucketId] ?? '#6b7280';
      // Motion trail: reset to empty on spawn
      p.trail         = [];

      // ── Sub-AC 6b: SVG emoji element for DOM-visible 🦞 particle ──────────
      // Creates a <text>🦞</text> inside the sim-canvas SVG so Playwright can
      // detect the emoji via textContent checks on [data-testid='sim-canvas'].
      // Runs only in browser (document must be defined) and when emojiGroup is set.
      // Uses CSS transitions for 0.2s linear animation — managed independently
      // from the Canvas 2D rAF loop to avoid per-frame DOM attribute updates.
      if (this._emojiGroup && typeof document !== 'undefined') {
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const textEl = document.createElementNS(SVG_NS, 'text');
        textEl.textContent = '🦞';
        textEl.setAttribute('font-size', '14');
        textEl.setAttribute('fill', p.color);
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('dominant-baseline', 'middle');
        // Place at spawn position with no transition yet (instant first paint)
        textEl.style.transform = `translate(${srcX}px, ${srcY}px)`;
        textEl.style.opacity   = '0.9';
        this._emojiGroup.appendChild(textEl);
        // Next rAF frame: start CSS transition toward product bucket
        requestAnimationFrame(() => {
          textEl.style.transition = 'transform 0.2s linear, opacity 0.2s linear';
          textEl.style.transform  = `translate(${dstX}px, ${dstY}px)`;
          textEl.style.opacity    = '0.15';
        });
        // Auto-remove after animation finishes (250ms > 200ms transition)
        setTimeout(() => {
          if (textEl.parentNode) textEl.remove();
        }, 260);
      }

      return p;
    }
    return null;  // pool exhausted
  }

  /**
   * Deactivate all active particles (e.g. on iteration reset).
   * Also clears any live SVG emoji elements from the emoji group.
   */
  clearAll() {
    for (const p of this.pool) p.active = false;
    // Remove all in-flight SVG emoji elements immediately
    if (this._emojiGroup) {
      while (this._emojiGroup.firstChild) {
        this._emojiGroup.removeChild(this._emojiGroup.firstChild);
      }
    }
  }

  /** Number of currently active particles */
  get activeCount() {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  // ── RAF loop ─────────────────────────────────────────────

  /** Start (or resume) the animation loop. */
  start() {
    if (this.running) return;
    this._frozen  = false;   // reset frozen state on new simulation start
    this.running  = true;
    this.lastTime = null;
    this._fpsPrevTs   = null;
    this._fpsFrames   = 0;
    this._fpsWindowMs = 0;
    this.rafId = requestAnimationFrame(this._tick);
  }

  /** Stop the animation loop. */
  stop() {
    this.running = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Freeze the particle engine — stop animation loop but preserve the last
   * rendered canvas frame. In-flight particles remain visible at their
   * current positions (unlike clearAll which removes them).
   *
   * Called on simulation_complete to show the final frozen particle state
   * after all agents have made their decisions.
   *
   * Sub-AC 6d: freeze all particles, show final frozen state.
   */
  freeze() {
    this._frozen = true;
    this.running = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    // Do NOT call clearAll() — keep particles at their last positions
    // The canvas naturally preserves the last rendered frame
  }

  /** Whether the engine is currently in a frozen (post-simulation) state */
  get frozen() {
    return this._frozen === true;
  }

  _tick(timestamp) {
    if (!this.running) return;

    // Delta time, capped at 100ms to avoid huge jumps after tab switch
    const dt = (this.lastTime != null)
      ? Math.min(timestamp - this.lastTime, 100)
      : 16;
    this.lastTime = timestamp;

    // Rolling FPS measurement (updated every ~500ms)
    if (this._fpsPrevTs === null) {
      this._fpsPrevTs   = timestamp;
      this._fpsFrames   = 0;
      this._fpsWindowMs = 0;
    }
    this._fpsFrames++;
    this._fpsWindowMs += dt;
    if (this._fpsWindowMs >= 500) {
      this.fps          = (this._fpsFrames / this._fpsWindowMs) * 1000;
      this._fpsFrames   = 0;
      this._fpsWindowMs = 0;
      this._fpsPrevTs   = timestamp;
    }

    this._update(dt);
    this._render();

    this.rafId = requestAnimationFrame(this._tick);
  }

  // ── Simulation update ─────────────────────────────────────

  _update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;

      // ── Sub-AC 6e: Record trail before updating position ────────────────
      // Sample every other frame via a crude modulo on elapsed time
      // to avoid trail over-sampling on high-fps displays.
      if (p.elapsed > 0) {
        // Push current position into trail history
        p.trail.push({ x: p.x, y: p.y });
        // Keep only the last TRAIL_MAX samples
        if (p.trail.length > TRAIL_MAX) p.trail.shift();
      }

      p.elapsed += dt;
      const t = Math.min(p.elapsed / PARTICLE_DURATION_MS, 1);
      // Linear interpolation (0.2s linear per PRD §12.3)
      p.x = p.startX + (p.endX - p.startX) * t;
      p.y = p.startY + (p.endY - p.startY) * t;

      // ── Primary hit-detection: time-based (t ≥ 1) ────────────────
      if (t >= 1) {
        p.active = false;
        continue;
      }

      // ── Secondary hit-detection: spatial proximity to target bucket ──
      // Fires when the particle enters the bucket's hitRadius, which may be
      // slightly before t=1 when the bucket position is registered.
      if (p.targetBucket) {
        const bucket = this._buckets.get(p.targetBucket);
        if (bucket) {
          const dx    = p.x - bucket.x;
          const dy    = p.y - bucket.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 <= bucket.hitRadius * bucket.hitRadius) {
            p.active = false;
          }
        }
      }
    }
  }

  // ── Canvas render ─────────────────────────────────────────

  _render() {
    const { ctx } = this;
    const w = this._cssW;
    const h = this._cssH;

    ctx.clearRect(0, 0, w, h);

    // Draw faint bucket hit-zone rings beneath the particles
    this._drawBuckets(ctx);

    // Draw active particles as 🦞 emoji (Sub-AC 6b) with archetype-colored glow
    // Sub-AC 6e: motion trail + role-based color coding
    ctx.save();
    for (const p of this.pool) {
      if (!p.active) continue;
      const t     = Math.min(p.elapsed / PARTICLE_DURATION_MS, 1);
      // Fade out as particle approaches destination
      const alpha = 0.9 - 0.7 * t;

      // ── Sub-AC 6e: Motion trail — fading ghost circles behind the particle ──
      // Trail samples stored newest-last; render oldest (lowest opacity) first
      const trailLen = p.trail.length;
      for (let i = 0; i < trailLen; i++) {
        const trailT     = (i + 1) / (trailLen + 1);   // 0→1 (older→newer)
        const trailAlpha = alpha * trailT * 0.35;       // max ~35% of main alpha
        const trailR     = p.radius * 0.5 * trailT;    // shrinks toward origin
        ctx.globalAlpha  = trailAlpha;
        ctx.beginPath();
        ctx.arc(p.trail[i].x, p.trail[i].y, trailR + 1, 0, Math.PI * 2);
        // Trail color: role-tinted (seller = blue, market = archetype color)
        ctx.fillStyle = p.role === 'seller' ? '#2563eb' : p.color;
        ctx.fill();
      }

      // ── Sub-AC 6e: Role-based glow ring ──────────────────────────────────
      // Seller role (→ our_product): bright blue outer ring — signals "we won this buyer"
      // Market role (→ competitor):  target product color ring — signals "competitor won"
      const glowColor = p.role === 'seller' ? '#2563eb' : p.targetColor;
      const glowR     = p.role === 'seller' ? 14 : 11;
      ctx.globalAlpha = alpha * (p.role === 'seller' ? 0.55 : 0.35);
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();

      // ── Archetype-colored inner glow circle behind the emoji ──
      ctx.globalAlpha = alpha * 0.40;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();

      // ── 🦞 emoji particle — font-size 14px, centered ──
      // fillText is not available in test mocks, guard gracefully
      if (typeof ctx.fillText === 'function') {
        ctx.globalAlpha  = alpha;
        ctx.font         = '18px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji ?? '🦞', p.x, p.y);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * Draw styled bucket hit-zone overlays on the canvas — Sub-AC 6e visual polish.
   *
   * Each bucket is rendered as:
   *   1. A soft radial gradient fill (subtle color halo)
   *   2. A dashed ring outline
   *   3. A canvas label below the ring (Korean product name)
   *
   * The 'our_product' (seller) bucket gets an extra outer glow ring to
   * distinguish the seller role from the market/competitor buckets.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  _drawBuckets(ctx) {
    if (this._buckets.size === 0) return;
    ctx.save();

    for (const bucket of this._buckets.values()) {
      const { x, y, hitRadius, color, label, id } = bucket;
      const isSeller = id === SELLER_PRODUCT_ID;

      // ── 1. Soft radial gradient fill (color halo) ────────────────────────
      // Only visible in browser (createRadialGradient may not exist in test mocks)
      if (typeof ctx.createRadialGradient === 'function') {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, hitRadius * 1.4);
        // Seller gets stronger center glow; market gets very subtle
        grad.addColorStop(0,   isSeller
          ? `${color}22`   // center: 13% opacity
          : `${color}0f`); // center: 6% opacity
        grad.addColorStop(1, `${color}00`); // edge: 0% (transparent)
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, hitRadius * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // ── 2a. Seller extra outer glow ring (our_product only) ──────────────
      if (isSeller) {
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.arc(x, y, hitRadius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── 2b. Dashed ring outline ──────────────────────────────────────────
      ctx.globalAlpha = isSeller ? 0.22 : 0.12;
      ctx.beginPath();
      ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth   = isSeller ? 1.8 : 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── 3. Canvas label below the ring ───────────────────────────────────
      // Only rendered in browser (fillText may not exist in test mocks)
      if (typeof ctx.fillText === 'function' && label) {
        ctx.globalAlpha = isSeller ? 0.55 : 0.30;
        ctx.font        = isSeller
          ? 'bold 9px Pretendard Variable, system-ui, sans-serif'
          : '8px Pretendard Variable, system-ui, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle    = color;
        ctx.fillText(label, x, y + hitRadius + 4);
      }
    }

    ctx.restore();
  }

  // ── Performance benchmark ─────────────────────────────────

  /**
   * Spawn 800 particles and measure FPS over ~2 seconds using performance.now().
   * Verifies ≥30fps requirement.
   *
   * @param {function(string): {x:number, y:number}|null} getNodePos
   *   Callback that returns {x, y} for a given node ID (archetype or product).
   *   Must be provided externally since engine has no DOM knowledge.
   * @returns {Promise<{fps: number, passed: boolean, activeOnSpawn: number}>}
   */
  runPerfBench(getNodePos) {
    return new Promise((resolve) => {
      const archetypeIds = Object.keys(ARCHETYPE_COLORS);
      const productIds   = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

      // Spawn 800 particles with staggered elapsed times so they're all mid-flight
      let spawned = 0;
      for (let i = 0; i < 800; i++) {
        const archetypeId = archetypeIds[i % archetypeIds.length];
        const productId   = productIds[i % productIds.length];
        const src = getNodePos(archetypeId) ?? { x: this._cssW * 0.2, y: this._cssH * 0.3 };
        const dst = getNodePos(productId)   ?? { x: this._cssW * 0.8, y: this._cssH * 0.8 };
        const p = this._spawnAt(src.x, src.y, dst.x, dst.y, archetypeId, productId);
        if (p) {
          // Stagger elapsed so particles aren't all at t=0 simultaneously
          p.elapsed = (i / 800) * PARTICLE_DURATION_MS * 0.6;
          spawned++;
        }
      }

      // Count frames over 2 seconds using a separate RAF chain
      const benchStart = performance.now();
      let frames = 0;

      const countFrame = (ts) => {
        frames++;
        const elapsed = performance.now() - benchStart;
        if (elapsed < 2000) {
          requestAnimationFrame(countFrame);
        } else {
          const fps    = frames / (elapsed / 1000);
          const passed = fps >= 30;
          console.log(
            `[particle-bench] 800 particles | ${fps.toFixed(1)} fps | ` +
            `${passed ? 'PASS ✓' : 'FAIL ✗'} (≥30fps required)`
          );
          // Clean up bench particles
          this.clearAll();
          resolve({ fps, passed, activeOnSpawn: spawned });
        }
      };

      requestAnimationFrame(countFrame);
    });
  }
}
