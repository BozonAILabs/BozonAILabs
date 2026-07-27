const vertexSource = `
  attribute vec2 aVertexPosition;

  void main() {
    gl_Position = vec4(aVertexPosition, 0.0, 1.0);
  }
`

const fragmentSource = `
  precision highp float;

  uniform vec2 iResolution;
  uniform vec2 iPointer;
  uniform float iTime;
  uniform float iScene;

  const vec3 canvas = vec3(0.0235, 0.0667, 0.0510);
  const vec3 deepGreen = vec3(0.0510, 0.2314, 0.1804);
  const vec3 logoGreen = vec3(0.1843, 0.6196, 0.4980);
  const vec3 brightGreen = vec3(0.3569, 0.7608, 0.6314);

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
  }

  float sdBox(vec2 point, vec2 bounds) {
    vec2 distance = abs(point) - bounds;
    return length(max(distance, 0.0)) + min(max(distance.x, distance.y), 0.0);
  }

  float sdSegment(vec2 point, vec2 start, vec2 end) {
    vec2 pointVector = point - start;
    vec2 segmentVector = end - start;
    float amount = clamp(dot(pointVector, segmentVector) / dot(segmentVector, segmentVector), 0.0, 1.0);
    return length(pointVector - segmentVector * amount);
  }

  float fillBox(vec2 point, vec2 bounds) {
    return 1.0 - smoothstep(0.0, 0.012, sdBox(point, bounds));
  }

  float boxRing(vec2 point, vec2 bounds, float width) {
    return 1.0 - smoothstep(width, width + 0.012, abs(sdBox(point, bounds)));
  }

  float lineSegment(vec2 point, vec2 start, vec2 end, float width) {
    return 1.0 - smoothstep(width, width + 0.012, sdSegment(point, start, end));
  }

  float heroShape(vec2 point) {
    float shape = 0.0;

    for (int index = 0; index < 13; index++) {
      float item = float(index);
      float x = (item - 6.0) * 0.105;
      float variation = hash(vec2(item, 4.0));
      float height = mix(0.08, 0.29, variation);
      float centreY = -0.42 + height * 0.5;
      float block = fillBox(point - vec2(x, centreY), vec2(0.041, height * 0.5));
      shape = max(shape, block * mix(0.42, 1.0, variation));
    }

    float centralFrame = boxRing(point - vec2(0.0, -0.225), vec2(0.24, 0.125), 0.026);
    float centralCore = fillBox(point - vec2(0.0, -0.225), vec2(0.065, 0.065));
    shape = max(shape, centralFrame * 0.88);
    shape = max(shape, centralCore);
    return shape;
  }

  float qualityShape(vec2 point) {
    vec2 local = point - vec2(0.18, 0.12);
    float shape = boxRing(local, vec2(0.43, 0.245), 0.025);
    shape = max(shape, boxRing(local, vec2(0.315, 0.16), 0.025) * 0.9);
    shape = max(shape, boxRing(local, vec2(0.195, 0.082), 0.025) * 0.82);
    shape = max(shape, fillBox(local, vec2(0.055, 0.055)));

    shape = max(shape, lineSegment(local, vec2(-0.43, -0.245), vec2(-0.315, -0.16), 0.018));
    shape = max(shape, lineSegment(local, vec2(0.43, 0.245), vec2(0.315, 0.16), 0.018));
    shape = max(shape, lineSegment(local, vec2(-0.43, 0.245), vec2(-0.315, 0.16), 0.018));
    shape = max(shape, lineSegment(local, vec2(0.43, -0.245), vec2(0.315, -0.16), 0.018));
    return shape;
  }

  float speedShape(vec2 point) {
    vec2 local = point - vec2(0.1, 0.13);
    float shape = 0.0;

    for (int index = 0; index < 7; index++) {
      float item = float(index);
      float y = (item - 3.0) * 0.075;
      float inset = abs(item - 3.0) * 0.045;
      vec2 start = vec2(-0.62 + inset, y - 0.105);
      vec2 end = vec2(0.48 - inset * 0.35, y + 0.105);
      float stream = lineSegment(local, start, end, 0.018);
      shape = max(shape, stream * mix(0.48, 1.0, 1.0 - abs(item - 3.0) / 4.0));
    }

    shape = max(shape, lineSegment(local, vec2(0.33, 0.02), vec2(0.53, 0.13), 0.022));
    shape = max(shape, lineSegment(local, vec2(0.53, 0.13), vec2(0.35, 0.27), 0.022));
    shape = max(shape, fillBox(local - vec2(-0.5, -0.09), vec2(0.05, 0.05)) * 0.72);
    return shape;
  }

  float priceShape(vec2 point) {
    vec2 local = point - vec2(0.16, 0.11);
    float shape = 0.0;

    shape = max(shape, boxRing(local, vec2(0.42, 0.23), 0.024) * 0.56);
    shape = max(shape, fillBox(local - vec2(-0.23, 0.1), vec2(0.105, 0.065)) * 0.78);
    shape = max(shape, fillBox(local - vec2(0.0, 0.1), vec2(0.075, 0.065)) * 0.88);
    shape = max(shape, fillBox(local - vec2(0.2, 0.1), vec2(0.085, 0.065)));
    shape = max(shape, fillBox(local - vec2(-0.14, -0.09), vec2(0.15, 0.055)) * 0.76);
    shape = max(shape, fillBox(local - vec2(0.17, -0.09), vec2(0.11, 0.055)) * 0.94);
    shape = max(shape, lineSegment(local, vec2(-0.23, 0.02), vec2(-0.14, -0.03), 0.017));
    shape = max(shape, lineSegment(local, vec2(0.0, 0.02), vec2(0.17, -0.03), 0.017));
    return shape;
  }

  void main() {
    float spacing = mix(11.0, 20.0, smoothstep(560.0, 1900.0, iResolution.x));
    vec2 cell = floor(gl_FragCoord.xy / spacing);
    vec2 cellCentre = (cell + 0.5) * spacing;
    vec2 uv = cellCentre / iResolution.xy;
    float aspect = iResolution.x / iResolution.y;
    vec2 point = uv - 0.5;
    point.x *= aspect;
    point.x /= min(1.0, aspect / 1.22);

    vec2 pointerOffset = (iPointer - 0.5) * vec2(0.035, 0.022);
    point -= pointerOffset;

    float hero = heroShape(point);
    float quality = qualityShape(point);
    float speed = speedShape(point);
    float price = priceShape(point);

    float heroToQuality = smoothstep(0.0, 1.0, clamp(iScene, 0.0, 1.0));
    float qualityToSpeed = smoothstep(0.0, 1.0, clamp(iScene - 1.0, 0.0, 1.0));
    float speedToPrice = smoothstep(0.0, 1.0, clamp(iScene - 2.0, 0.0, 1.0));
    float shape = mix(hero, quality, heroToQuality);
    shape = mix(shape, speed, qualityToSpeed);
    shape = mix(shape, price, speedToPrice);

    float randomValue = hash(cell);
    float pulse = 0.92 + sin(iTime * 0.72 + randomValue * 6.2831) * 0.08;
    float intensity = shape * mix(0.48, 1.0, randomValue) * pulse;
    float radius = spacing * mix(0.13, 0.27, clamp(intensity, 0.0, 1.0));
    float dotDistance = length(gl_FragCoord.xy - cellCentre);
    float dotMask = 1.0 - smoothstep(radius, radius + 1.2, dotDistance);

    vec2 rawPoint = gl_FragCoord.xy / iResolution.xy - 0.5;
    float atmosphere = exp(-dot(rawPoint * vec2(0.72, 1.35), rawPoint * vec2(0.72, 1.35)) * 3.0);
    float vignette = smoothstep(0.84, 0.18, length(rawPoint * vec2(0.72, 1.0)));
    vec3 dotColor = mix(deepGreen, logoGreen, clamp(intensity * 0.82, 0.0, 1.0));
    dotColor = mix(dotColor, brightGreen, pow(clamp(intensity, 0.0, 1.0), 2.2) * 0.42);

    vec3 color = canvas;
    color += deepGreen * atmosphere * 0.11;
    color = mix(color, dotColor, dotMask * clamp(intensity, 0.0, 1.0) * vignette);

    float dither = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    color += dither;
    gl_FragColor = vec4(color, 1.0);
  }
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }

  return shader
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)

  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Shader program link error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  return program
}

export interface ShaderBackgroundController {
  setScene: (scene: number) => void
  destroy: () => void
}

const unavailableController = (): ShaderBackgroundController => ({
  setScene: () => undefined,
  destroy: () => undefined,
})

export function initShaderBackground(
  canvas: HTMLCanvasElement,
): ShaderBackgroundController {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
  })

  if (!gl) {
    canvas.dataset.webgl = 'unavailable'
    return unavailableController()
  }

  const program = createProgram(gl)
  if (!program) {
    canvas.dataset.webgl = 'unavailable'
    return unavailableController()
  }

  const positionBuffer = gl.createBuffer()
  if (!positionBuffer) {
    canvas.dataset.webgl = 'unavailable'
    gl.deleteProgram(program)
    return unavailableController()
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  )

  const vertexPosition = gl.getAttribLocation(program, 'aVertexPosition')
  const resolutionLocation = gl.getUniformLocation(program, 'iResolution')
  const pointerLocation = gl.getUniformLocation(program, 'iPointer')
  const timeLocation = gl.getUniformLocation(program, 'iTime')
  const sceneLocation = gl.getUniformLocation(program, 'iScene')
  const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointerTarget = { x: 0.5, y: 0.5 }
  const pointerCurrent = { x: 0.5, y: 0.5 }
  let frameId: number | null = null
  let visible = true
  let destroyed = false
  let elapsed = 0
  let previousTime = performance.now()
  let scene = 0

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect()
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
    const width = Math.max(1, Math.round(bounds.width * pixelRatio))
    const height = Math.max(1, Math.round(bounds.height * pixelRatio))

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }
  }

  const draw = (now: number): void => {
    frameId = null
    if (destroyed) return

    const delta = Math.min((now - previousTime) / 1000, 0.05)
    previousTime = now
    if (!reduceMotionQuery.matches) elapsed += delta

    pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * 0.05
    pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * 0.05

    gl.useProgram(program)
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
    gl.uniform2f(pointerLocation, pointerCurrent.x, pointerCurrent.y)
    gl.uniform1f(timeLocation, elapsed)
    gl.uniform1f(sceneLocation, scene)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(vertexPosition)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    if (visible && !document.hidden && !reduceMotionQuery.matches) {
      frameId = requestAnimationFrame(draw)
    }
  }

  const requestDraw = (): void => {
    if (frameId === null && !destroyed) {
      previousTime = performance.now()
      frameId = requestAnimationFrame(draw)
    }
  }

  const handlePointer = (event: PointerEvent): void => {
    pointerTarget.x = Math.min(1, Math.max(0, event.clientX / window.innerWidth))
    pointerTarget.y = Math.min(1, Math.max(0, 1 - event.clientY / window.innerHeight))
  }

  const handleVisibility = (): void => {
    if (!document.hidden && visible) requestDraw()
  }

  const handleMotionPreference = (): void => requestDraw()

  const resizeObserver = new ResizeObserver(() => {
    resize()
    requestDraw()
  })
  resizeObserver.observe(canvas)

  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      if (visible) requestDraw()
    },
    { rootMargin: '80px' },
  )
  visibilityObserver.observe(canvas)

  window.addEventListener('pointermove', handlePointer, { passive: true })
  document.addEventListener('visibilitychange', handleVisibility)
  reduceMotionQuery.addEventListener('change', handleMotionPreference)

  canvas.dataset.webgl = 'ready'
  resize()
  requestDraw()

  return {
    setScene: (nextScene: number): void => {
      scene = Math.min(3, Math.max(0, nextScene))
      if (reduceMotionQuery.matches || !visible) requestDraw()
    },
    destroy: (): void => {
      destroyed = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      visibilityObserver.disconnect()
      window.removeEventListener('pointermove', handlePointer)
      document.removeEventListener('visibilitychange', handleVisibility)
      reduceMotionQuery.removeEventListener('change', handleMotionPreference)
      gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(program)
    },
  }
}
