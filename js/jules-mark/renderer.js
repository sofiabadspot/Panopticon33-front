// Copiado de sentinel-front/src/components/ds/nebulosa/renderer.js (Nebulosa, marca de Jules).
// Único cambio: lee los colores de --jules-c1…c5 en vez de los tokens de marca.
import { advance, breathTarget, frameAt, initialPhases, smoothBreath } from './timeline.js'

// Dibuja todas las Nebulosas de la página con WebGL (la placa de video).
//
// Viene de jules-frontend (src/components/julesOrb/renderer.ts), donde se hizo
// primero. Antes la Nebulosa era un SVG con desenfoques y máscaras animados, y
// Chrome dejaba un recuadro de líneas alrededor al dibujarlo; con un canvas eso
// no pasa.
//
// Hay un solo "pincel" WebGL para toda la página (Chrome deja tener pocos):
// dibuja cada Nebulosa en un lienzo compartido y la copia a su propio <canvas>.
// Un solo bucle de animación recorre las que se están moviendo y se apaga solo
// cuando no queda ninguna.

const VERT = 'attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}'

// El dibujo usa las coordenadas del SVG de las vistas (200×200, centro 100,100),
// en la zona -60..260 para que entren el halo y las manchas que se salen.
const FRAG = `precision highp float;varying vec2 v;
uniform float uSwirl,uLights,uBreath,uLift,uHaloS,uHaloA,uLimeA;uniform vec2 uB[4];
uniform vec3 cLime,cBlue,cDeep,cSage,cGreen;
float erf1(float x){float a=.147;float x2=x*x;float t=sqrt(1.-exp(-x2*(1.2732395+a*x2)/(1.+a*x2)));return x<0.?-t:t;}
float cov(float d,float r,float s){return .5*(1.-erf1((d-r)/(s*1.4142136)));}
vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
vec3 grad(float t){
  if(t<.4)return mix(cDeep,cBlue,t/.4);
  if(t<.7)return mix(cBlue,cSage,(t-.4)/.3);
  return mix(cSage,cLime,(t-.7)/.3);}
void main(){
  vec2 p=vec2(-60.,-60.)+vec2(v.x,1.-v.y)*320.;
  vec2 c=vec2(100.);
  float hA=cov(length(p-c)/uHaloS,86.,20.)*uHaloA;
  vec2 q=(p-c-vec2(0.,uLift))/uBreath+c;
  vec2 m=rot(q-c,-uSwirl)+c;
  float u=cov(length(m-c),54.,12.);
  u=1.-(1.-u)*(1.-cov(length(m-c-uB[0]),26.,12.));
  u=1.-(1.-u)*(1.-cov(length(m-c-uB[1]),22.,12.));
  u=1.-(1.-u)*(1.-cov(length(m-c-uB[2]),24.,12.));
  u=1.-(1.-u)*(1.-cov(length(m-c-uB[3]),20.,12.));
  float mk=smoothstep(.1,.75,u);
  vec3 col=grad(clamp(((q.x-20.)+(q.y-20.))/320.,0.,1.));
  vec2 l=rot(q-c,uLights)+c;
  col=mix(col,cLime,uLimeA*cov(length(l-vec2(66.,62.)),40.,16.));
  col=mix(col,cGreen,cov(length(l-vec2(146.,96.)),34.,16.));
  col=mix(col,cBlue,cov(length(l-vec2(92.,150.)),38.,16.));
  col=mix(col,vec3(1.),.55*cov(length(l-c),22.,16.));
  gl_FragColor=vec4(col*mk+cBlue*hA*(1.-mk),mk+hA*(1.-mk));
}`

// Colores del DS (tokens.css), los mismos que usaba el SVG de las vistas.
// Panóptico 33: los colores de Jules viven en css/theme.css (--jules-c1…c5).
// Son los de la marca Spotvision y solo se usan acá: Jules es lo único con
// color en la consola, además de los estados.
const COLORES = [
  ['cLime', '--jules-c1'],
  ['cBlue', '--jules-c2'],
  ['cDeep', '--jules-c3'],
  ['cSage', '--jules-c4'],
  ['cGreen', '--jules-c5'],
]

/** Si la computadora no tiene WebGL: un degradado quieto con los colores del DS, mejor que un hueco. */
const FONDO_SIN_WEBGL =
  'radial-gradient(circle at 45% 45%, var(--jules-c1) 0 12%, var(--jules-c2) 26%, transparent 34%)'

let gpu // undefined = todavía no se probó; null = no hay WebGL

function hexToRgb(hex) {
  const h = hex.trim().replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}

function initGpu() {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true })
  if (!gl) return null
  const compile = (type, src) => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
  }
  const vs = compile(gl.VERTEX_SHADER, VERT)
  const fs = compile(gl.FRAGMENT_SHADER, FRAG)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const uni = (name) => gl.getUniformLocation(prog, name)
  const css = getComputedStyle(document.documentElement)
  COLORES.forEach(([u, token]) => gl.uniform3fv(uni(u), hexToRgb(css.getPropertyValue(token))))
  return { canvas, gl, uni }
}

const orbs = new Set()
let raf = 0
let last = 0

const menosMovimiento = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const seMueve = () => !menosMovimiento()

function draw(g, o) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(o.canvas.clientWidth * dpr)
  const h = Math.round(o.canvas.clientHeight * dpr)
  if (!w || !h || !o.ctx) return false // todavía sin tamaño: se reintenta cuando lo tenga
  if (o.canvas.width !== w || o.canvas.height !== h) {
    o.canvas.width = w
    o.canvas.height = h
  }
  if (g.canvas.width < w || g.canvas.height < h) {
    g.canvas.width = Math.max(g.canvas.width, w)
    g.canvas.height = Math.max(g.canvas.height, h)
  }
  const { gl, uni } = g
  const f = frameAt(o.phases, o.state, o.breath)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.uniform1f(uni('uSwirl'), f.swirl)
  gl.uniform1f(uni('uLights'), f.lights)
  gl.uniform1f(uni('uBreath'), f.breath)
  gl.uniform1f(uni('uLift'), f.lift)
  gl.uniform1f(uni('uHaloS'), f.haloScale)
  gl.uniform1f(uni('uHaloA'), f.haloAlpha)
  gl.uniform1f(uni('uLimeA'), f.limeAlpha)
  gl.uniform2fv(uni('uB'), new Float32Array(f.blobs))
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  o.ctx.clearRect(0, 0, w, h)
  // WebGL dibuja desde abajo a la izquierda del lienzo compartido.
  o.ctx.drawImage(g.canvas, 0, g.canvas.height - h, w, h, 0, 0, w, h)
  return true
}

function tick(now) {
  raf = 0
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
  last = now
  if (!gpu) return
  let quedan = false
  orbs.forEach((o) => {
    const vivo = seMueve()
    if (vivo) {
      o.phases = advance(o.phases, o.state, dt)
      o.breath = smoothBreath(o.breath, breathTarget(o.state, o.phases.breath), dt)
    }
    if (vivo || !o.drawn) o.drawn = draw(gpu, o)
    // Una Nebulosa sin tamaño (escondida) no mantiene vivo el bucle: cuando
    // aparezca, su ResizeObserver lo vuelve a pedir.
    if (vivo && o.drawn) quedan = true
  })
  if (quedan) raf = requestAnimationFrame(tick)
  else last = 0
}

function kick() {
  if (!raf && gpu) raf = requestAnimationFrame(tick)
}

/**
 * Suma un <canvas> como Nebulosa. Devuelve { set(state), dispose() }.
 * Solo se llama en el navegador (desde un useEffect).
 */
export function registerOrb(canvas) {
  if (gpu === undefined) gpu = initGpu()
  if (!gpu) {
    canvas.style.background = FONDO_SIN_WEBGL
    return { set() {}, dispose() {} }
  }
  const o = {
    canvas,
    ctx: canvas.getContext('2d'),
    state: 'idle',
    phases: initialPhases(),
    breath: breathTarget('idle', 0),
    drawn: false,
    resize: null,
  }
  if (typeof ResizeObserver === 'function') {
    o.resize = new ResizeObserver(() => {
      o.drawn = false
      kick()
    })
    o.resize.observe(canvas)
  }
  orbs.add(o)
  kick()
  return {
    set(state) {
      if (state === o.state) return
      o.state = state
      o.drawn = false
      kick()
    },
    dispose() {
      if (o.resize) o.resize.disconnect()
      orbs.delete(o)
    },
  }
}
