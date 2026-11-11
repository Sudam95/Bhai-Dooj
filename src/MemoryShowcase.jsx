// MemoryShowcase.jsx
// Lightweight 3D memory showcase: React Three Fiber + Three.js + Framer Motion.
// No database, no drei, no post-processing. Data comes from ./memories.js.
//
// npm i react react-dom three @react-three/fiber framer-motion

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion'
import * as THREE from 'three'
import { memories } from './memories'

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const BG = '#f4f1ea'
const PAPER = '#fbf8f1'
const INK = '#3b342c'
const MUTED_INK = '#8a8176'
const SERIF = 'Georgia, "Times New Roman", serif'
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

const CARD_W = 1.7
const CARD_H = 2.1
const CARD_T = 0.04
const PHOTO = 1.4
const BASE_CAM_Z = 9
const MAX_VOLUME = 0.6

const clamp = THREE.MathUtils.clamp

// Accepts 'YYYY-MM-DD' (formatted nicely) or any plain text label (shown as is).
const formatDate = (value) => {
  const d = new Date(value)
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(value)) || Number.isNaN(d.getTime())) {
    return String(value)
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/* -------------------------------------------------------------------------- */
/*  Procedural textures (no asset files needed besides the photos)            */
/* -------------------------------------------------------------------------- */

function makeCaptionTexture(title, date) {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  let size = 56
  ctx.font = `italic 600 ${size}px ${SERIF}`
  while (ctx.measureText(title).width > 700 && size > 26) {
    size -= 2
    ctx.font = `italic 600 ${size}px ${SERIF}`
  }
  ctx.fillStyle = INK
  ctx.fillText(title, canvas.width / 2, 110)

  ctx.font = `500 26px ${SANS}`
  ctx.fillStyle = MUTED_INK
  ctx.fillText(formatDate(date).toUpperCase(), canvas.width / 2, 172)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function makePlaceholderTexture(label) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 512, 512)
  g.addColorStop(0, '#e6dccb')
  g.addColorStop(1, '#cfc3ae')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle = 'rgba(59,52,44,0.45)'
  ctx.textAlign = 'center'
  ctx.font = `italic 34px ${SERIF}`
  ctx.fillText(label, 256, 268)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Soft drop shadow built from stacked translucent rects (no blur filter needed).
let shadowTexture = null
function getShadowTexture() {
  if (shadowTexture) return shadowTexture
  const w = 256
  const h = 320
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(70, 52, 32, 0.035)'
  for (let i = 0; i < 32; i++) {
    const inset = 4 + i * 2.2
    ctx.fillRect(inset, inset, w - inset * 2, h - inset * 2)
  }
  shadowTexture = new THREE.CanvasTexture(canvas)
  shadowTexture.colorSpace = THREE.SRGBColorSpace
  return shadowTexture
}

// Center-crop a texture so a non-square photo fills the square photo area.
function coverFit(tex) {
  const img = tex.image
  if (!img || !img.width || !img.height) return
  const aspect = img.width / img.height
  tex.repeat.set(1, 1)
  tex.offset.set(0, 0)
  if (aspect > 1) {
    tex.repeat.x = 1 / aspect
    tex.offset.x = (1 - tex.repeat.x) / 2
  } else {
    tex.repeat.y = aspect
    tex.offset.y = (1 - tex.repeat.y) / 2
  }
}

function usePhotoTexture(url, label) {
  const [texture, setTexture] = useState(null)

  useEffect(() => {
    let disposed = false
    let current = null

    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (disposed) {
          tex.dispose()
          return
        }
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 8
        coverFit(tex)
        current = tex
        setTexture(tex)
      },
      undefined,
      () => {
        if (disposed) return
        current = makePlaceholderTexture(label)
        setTexture(current)
      }
    )

    return () => {
      disposed = true
      if (current) current.dispose()
    }
  }, [url, label])

  return texture
}

/* -------------------------------------------------------------------------- */
/*  Audio: HTML5 Audio with fade in / fade out                                */
/* -------------------------------------------------------------------------- */

function useMemoryAudio() {
  const audioRef = useRef(null)
  const fadeInRef = useRef(null)
  const mutedRef = useRef(false)
  const [muted, setMuted] = useState(false)

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audioRef.current = null
    if (fadeInRef.current) fadeInRef.current.stop()

    animate(audio.volume, 0, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => {
        audio.volume = clamp(v, 0, 1)
      },
      onComplete: () => {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      },
    })
  }, [])

  // Must be called from inside the tap/click handler so browsers allow playback.
  const play = useCallback(
    (src) => {
      stop()
      const audio = new Audio(src)
      audio.loop = true
      audio.preload = 'auto'
      audio.volume = 0
      audio.muted = mutedRef.current
      audioRef.current = audio

      const attempt = audio.play()
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          /* missing file or blocked by the browser: stay silent */
        })
      }

      fadeInRef.current = animate(0, MAX_VOLUME, {
        duration: 1.2,
        ease: 'easeInOut',
        onUpdate: (v) => {
          audio.volume = clamp(v, 0, 1)
        },
      })
    },
    [stop]
  )

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if (audioRef.current) audioRef.current.muted = next
  }, [])

  useEffect(
    () => () => {
      if (fadeInRef.current) fadeInRef.current.stop()
      if (audioRef.current) audioRef.current.pause()
    },
    []
  )

  return { play, stop, muted, toggleMute }
}

/* -------------------------------------------------------------------------- */
/*  3D: one Polaroid-style card                                               */
/* -------------------------------------------------------------------------- */

const HOVER_SPRING = { type: 'spring', stiffness: 170, damping: 18 }
const FOCUS_SPRING = { type: 'spring', stiffness: 80, damping: 15, mass: 1 }

function MemoryCard({ memory, index, locked, isActive, onSelect }) {
  const group = useRef()
  const shadowMesh = useRef()
  const shadowMat = useRef()

  const hover = useMotionValue(0)
  const focus = useMotionValue(0)
  const tilt = useRef({ x: 0, y: 0, tx: 0, ty: 0 })

  const photo = usePhotoTexture(memory.image, memory.title)
  const caption = useMemo(
    () => makeCaptionTexture(memory.title, memory.date),
    [memory.title, memory.date]
  )
  useEffect(() => () => caption.dispose(), [caption])

  const shadowTex = useMemo(() => getShadowTexture(), [])

  const base = useMemo(() => new THREE.Vector3(...memory.position), [memory.position])
  const phase = index * 1.7
  const baseRotZ = (((index * 37) % 9) - 4) * 0.012

  // Reusable scratch objects (avoid per-frame allocations)
  const scratch = useMemo(
    () => ({
      euler: new THREE.Euler(),
      quat: new THREE.Quaternion(),
      dir: new THREE.Vector3(),
      target: new THREE.Vector3(),
    }),
    []
  )

  // Spring the card toward / away from the camera.
  useEffect(() => {
    const controls = animate(focus, isActive ? 1 : 0, FOCUS_SPRING)
    return () => controls.stop()
  }, [isActive, focus])

  // When another card is open, drop any hover state.
  useEffect(() => {
    if (locked) {
      animate(hover, 0, HOVER_SPRING)
      tilt.current.tx = 0
      tilt.current.ty = 0
    }
  }, [locked, hover])

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  useFrame(({ clock, camera, size }, delta) => {
    const g = group.current
    if (!g) return

    const t = clock.elapsedTime
    const h = hover.get()
    const f = focus.get()
    const k = 1 - Math.exp(-delta * 8)

    // Smooth the pointer-driven tilt
    const tl = tilt.current
    tl.x += (tl.tx * h - tl.x) * k
    tl.y += (tl.ty * h - tl.y) * k

    // Gentle idle float + hover lift
    g.position.set(
      base.x + Math.sin(t * 0.35 + phase) * 0.04,
      base.y + Math.sin(t * 0.6 + phase) * 0.1 + h * 0.12,
      base.z + h * 0.5
    )

    scratch.euler.set(
      -tl.y * 0.25,
      tl.x * 0.25 + Math.sin(t * 0.35 + phase) * 0.05,
      baseRotZ + Math.sin(t * 0.4 + phase) * 0.025
    )
    scratch.quat.setFromEuler(scratch.euler)

    let scale = 1 + h * 0.05

    // Zoom toward the camera: blend position, rotation and scale by focus.
    if (Math.abs(f) > 0.0005) {
      const aspect = size.width / size.height
      const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2
      const dist = Math.max(3.4, (CARD_W * 1.15) / (2 * Math.tan(halfFov) * aspect))

      camera.getWorldDirection(scratch.dir)
      scratch.target.copy(camera.position).addScaledVector(scratch.dir, dist)

      g.position.lerp(scratch.target, f)
      scratch.quat.slerp(camera.quaternion, clamp(f, 0, 1))
      scale = THREE.MathUtils.lerp(scale, 1.15, f)
    }

    g.quaternion.copy(scratch.quat)
    g.scale.setScalar(scale)

    // The shadow loosens and drifts as the card lifts.
    if (shadowMesh.current && shadowMat.current) {
      shadowMesh.current.position.set(0.1 + h * 0.08, -0.16 - h * 0.14, -0.07 - h * 0.1)
      shadowMesh.current.scale.setScalar(1 + h * 0.1)
      shadowMat.current.opacity = 0.62 - h * 0.17
    }
  })

  const handleOver = (e) => {
    if (locked) return
    e.stopPropagation()
    animate(hover, 1, HOVER_SPRING)
    document.body.style.cursor = 'pointer'
  }

  const handleOut = () => {
    animate(hover, 0, HOVER_SPRING)
    tilt.current.tx = 0
    tilt.current.ty = 0
    document.body.style.cursor = ''
  }

  const handleMove = (e) => {
    if (locked || !group.current) return
    e.stopPropagation()
    const p = group.current.worldToLocal(e.point.clone())
    tilt.current.tx = clamp(p.x / (CARD_W / 2), -1, 1)
    tilt.current.ty = clamp(p.y / (CARD_H / 2), -1, 1)
  }

  const handleClick = (e) => {
    if (locked) return
    e.stopPropagation()
    document.body.style.cursor = ''
    animate(hover, 0, HOVER_SPRING)
    onSelect(memory.id)
  }

  const faceZ = CARD_T / 2 + 0.002

  return (
    <group
      ref={group}
      position={memory.position}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onPointerMove={handleMove}
      onClick={handleClick}
    >
      {/* soft drop shadow */}
      <mesh ref={shadowMesh} position={[0.1, -0.16, -0.07]} renderOrder={-1}>
        <planeGeometry args={[CARD_W * 1.4, CARD_H * 1.3]} />
        <meshBasicMaterial
          ref={shadowMat}
          map={shadowTex}
          transparent
          opacity={0.62}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* paper frame */}
      <mesh>
        <boxGeometry args={[CARD_W, CARD_H, CARD_T]} />
        <meshStandardMaterial color={PAPER} roughness={1} metalness={0} />
      </mesh>

      {/* photo */}
      {photo && (
        <mesh position={[0, 0.2, faceZ]}>
          <planeGeometry args={[PHOTO, PHOTO]} />
          <meshBasicMaterial map={photo} toneMapped={false} />
        </mesh>
      )}

      {/* handwritten-style caption */}
      <mesh position={[0, -0.76, faceZ]}>
        <planeGeometry args={[1.5, 0.5]} />
        <meshBasicMaterial map={caption} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/*  3D: scene + camera rig                                                    */
/* -------------------------------------------------------------------------- */

// Subtle parallax. On narrow screens the camera pulls back and the pointer
// pans sideways so every card stays reachable.
function CameraRig({ frozen }) {
  useFrame(({ camera, pointer, size }, delta) => {
    if (frozen) return

    const aspect = size.width / size.height
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2
    const z = BASE_CAM_Z * Math.min(1.7, Math.max(1, 1.3 / aspect))
    const halfW = Math.tan(halfFov) * z * aspect
    const panX = Math.max(0.35, 6.4 - halfW)
    const panY = 0.3
    const k = 1 - Math.exp(-delta * 3)

    camera.position.x += (pointer.x * panX - camera.position.x) * k
    camera.position.y += (pointer.y * panY - camera.position.y) * k
    camera.position.z += (z - camera.position.z) * k
    camera.lookAt(camera.position.x, camera.position.y, 0)
  })
  return null
}

function Scene({ activeId, onSelect }) {
  const locked = activeId !== null
  return (
    <>
      <color attach="background" args={[BG]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[-3, 4, 8]} intensity={0.5} color="#fff4e0" />

      <CameraRig frozen={locked} />

      {memories.map((memory, i) => (
        <MemoryCard
          key={memory.id}
          memory={memory}
          index={i}
          locked={locked}
          isActive={activeId === memory.id}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*  Modal overlay                                                             */
/* -------------------------------------------------------------------------- */

function SpeakerIcon({ muted }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      {muted ? (
        <>
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  )
}

function MemoryModal({ memory, muted, onToggleMute, onClose }) {
  const [imageFailed, setImageFailed] = useState(false)
  const closeRef = useRef(null)

  useEffect(() => {
    if (closeRef.current) closeRef.current.focus()
  }, [])

  return (
    <motion.div
      style={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.15, duration: 0.45 } }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-title"
        style={styles.panel}
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { delay: 0.25, type: 'spring', stiffness: 140, damping: 18 },
        }}
        exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.2 } }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.imageWrap}>
          {imageFailed ? (
            <div style={styles.imageFallback}>Photo not found</div>
          ) : (
            <img
              src={memory.image}
              alt={memory.title}
              style={styles.image}
              onError={() => setImageFailed(true)}
            />
          )}
        </div>

        <div style={styles.body}>
          <p style={styles.date}>{formatDate(memory.date)}</p>
          <h2 id="memory-title" style={styles.title}>
            {memory.title}
          </h2>
          <p style={styles.description}>{memory.description}</p>
        </div>

        <div style={styles.controls}>
          <button
            type="button"
            style={styles.pill}
            onClick={onToggleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute music' : 'Mute music'}
          >
            <SpeakerIcon muted={muted} />
            <span>{muted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button
            ref={closeRef}
            type="button"
            style={{ ...styles.pill, ...styles.pillPrimary }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Root component                                                            */
/* -------------------------------------------------------------------------- */

export default function MemoryShowcase() {
  const [activeId, setActiveId] = useState(null)
  const { play, stop, muted, toggleMute } = useMemoryAudio()

  const activeMemory = useMemo(
    () => memories.find((m) => m.id === activeId) || null,
    [activeId]
  )

  const handleSelect = useCallback(
    (id) => {
      const memory = memories.find((m) => m.id === id)
      if (!memory) return
      setActiveId(id)
      play(memory.bgMusic) // runs inside the user's tap, so playback is allowed
    },
    [play]
  )

  const handleClose = useCallback(() => {
    setActiveId(null)
    stop()
  }, [stop])

  useEffect(() => {
    if (activeId === null) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, handleClose])

  return (
    <div style={styles.root}>
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 0, BASE_CAM_Z], fov: 45, near: 0.1, far: 60 }}
        style={{ position: 'absolute', inset: 0, background: BG }}
      >
        <Scene activeId={activeId} onSelect={handleSelect} />
      </Canvas>

      <header style={styles.header}>
        <h1 style={styles.heading}>Bhai Dooj</h1>
        <p style={styles.hint}>Tap a photograph to open it</p>
      </header>

      <AnimatePresence>
        {activeMemory && (
          <MemoryModal
            key={activeMemory.id}
            memory={activeMemory}
            muted={muted}
            onToggleMute={toggleMute}
            onClose={handleClose}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Styles                                                                    */
/* -------------------------------------------------------------------------- */

const styles = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
    background: BG,
    fontFamily: SANS,
  },
  header: {
    position: 'absolute',
    top: 22,
    left: 0,
    right: 0,
    textAlign: 'center',
    pointerEvents: 'none',
    color: INK,
  },
  heading: {
    margin: 0,
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: 400,
    fontSize: 'clamp(30px, 5vw, 44px)',
    letterSpacing: '0.01em',
  },
  hint: {
    margin: '4px 0 0',
    fontSize: 13,
    color: MUTED_INK,
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    background: 'rgba(244, 241, 234, 0.55)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  },
  panel: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '92vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
    padding: 14,
    background: PAPER,
    borderRadius: 4,
    boxShadow: '0 24px 60px rgba(70, 52, 32, 0.22), 0 2px 6px rgba(70, 52, 32, 0.12)',
    color: INK,
  },
  imageWrap: {
    background: '#efe9dd',
    borderRadius: 2,
    overflow: 'hidden',
  },
  image: {
    display: 'block',
    width: '100%',
    maxHeight: '46vh',
    objectFit: 'contain',
  },
  imageFallback: {
    height: 220,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: MUTED_INK,
    fontFamily: SERIF,
    fontStyle: 'italic',
  },
  body: {
    padding: '16px 6px 4px',
  },
  date: {
    margin: 0,
    fontSize: 12,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: MUTED_INK,
  },
  title: {
    margin: '6px 0 10px',
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: 600,
    fontSize: 28,
    lineHeight: 1.15,
  },
  description: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.6,
    color: '#5a5147',
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    padding: '18px 6px 4px',
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 16px',
    border: `1px solid ${MUTED_INK}55`,
    borderRadius: 999,
    background: 'transparent',
    color: INK,
    fontFamily: SANS,
    fontSize: 14,
    cursor: 'pointer',
  },
  pillPrimary: {
    background: INK,
    borderColor: INK,
    color: PAPER,
  },
}
