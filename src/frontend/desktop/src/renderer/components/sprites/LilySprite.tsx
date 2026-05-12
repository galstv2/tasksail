// Lily — Planning Specialist — robot-sprite-grammar-v1 §4.1 — copper round chassis, amber-eyed, dual antennas (female), paneled side fairings

import { EyeOptics } from './EyeOptics';

export function LilySprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'lily-r';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e8b888" />
          <stop offset="50%" stopColor="#c8966c" />
          <stop offset="100%" stopColor="#8a5e3a" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.34)" />
          <stop offset="30%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={`${id}-shell`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#a06038" />
          <stop offset="100%" stopColor="#5a2a18" />
        </linearGradient>
        <radialGradient id={`${id}-tip`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffd0b0" />
          <stop offset="60%" stopColor="#c84030" />
          <stop offset="100%" stopColor="#7a1810" />
        </radialGradient>
      </defs>

      {/* §2.4 Antennas — TWO (female) */}
      <g>
        <circle cx="20" cy="2.5" r="2.0" fill={`url(#${id}-tip)`} stroke="#7a1810" strokeWidth="0.4" />
        <circle cx="19.4" cy="1.9" r="0.55" fill="#fff0e0" opacity="0.9" />
        <line x1="20" y1="5" x2="20" y2="9" stroke="#3a1810" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="20" cy="5" r="0.55" fill="#1a0808" />
        <circle cx="20" cy="9" r="0.55" fill="#1a0808" />
        <line x1="20" y1="9.5" x2="20" y2="10.8" stroke="#3a1810" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="20" cy="10.8" r="0.5" fill="#1a0808" />
        <line x1="20" y1="11.3" x2="20" y2="12.6" stroke="#3a1810" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="17.8" y="12.6" width="4.4" height="1.7" rx="0.3" fill="#2a1408" stroke="#5a2a18" strokeWidth="0.3" />
        <circle cx="18.4" cy="13.45" r="0.32" fill="#7a4028" />
        <circle cx="21.6" cy="13.45" r="0.32" fill="#7a4028" />
        <circle cx="44" cy="2.5" r="2.0" fill={`url(#${id}-tip)`} stroke="#7a1810" strokeWidth="0.4" />
        <circle cx="43.4" cy="1.9" r="0.55" fill="#fff0e0" opacity="0.9" />
        <line x1="44" y1="5" x2="44" y2="9" stroke="#3a1810" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="44" cy="5" r="0.55" fill="#1a0808" />
        <circle cx="44" cy="9" r="0.55" fill="#1a0808" />
        <line x1="44" y1="9.5" x2="44" y2="10.8" stroke="#3a1810" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="44" cy="10.8" r="0.5" fill="#1a0808" />
        <line x1="44" y1="11.3" x2="44" y2="12.6" stroke="#3a1810" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="41.8" y="12.6" width="4.4" height="1.7" rx="0.3" fill="#2a1408" stroke="#5a2a18" strokeWidth="0.3" />
        <circle cx="42.4" cy="13.45" r="0.32" fill="#7a4028" />
        <circle cx="45.6" cy="13.45" r="0.32" fill="#7a4028" />
      </g>

      {/* §2.8 Headshell with faceted side fairings */}
      <ellipse cx="32" cy="28" rx="25" ry="24" fill={`url(#${id}-shell)`} />
      <path d="M32 8 L18 12 L11 22 L8 36 L11 50 L13 42 L13 28 L18 16 L26 11 Z" fill={`url(#${id}-shell)`} />
      <path d="M32 8 L46 12 L53 22 L56 36 L53 50 L51 42 L51 28 L46 16 L38 11 Z" fill={`url(#${id}-shell)`} />
      <path d="M14 18 L13 32" stroke="#1a0808" strokeWidth="0.5" opacity="0.55" />
      <path d="M11 38 L12 48" stroke="#1a0808" strokeWidth="0.4" opacity="0.45" />
      <path d="M50 18 L51 32" stroke="#1a0808" strokeWidth="0.5" opacity="0.55" />
      <path d="M53 38 L52 48" stroke="#1a0808" strokeWidth="0.4" opacity="0.45" />
      <line x1="32" y1="6" x2="32" y2="16" stroke="#1a0808" strokeWidth="0.7" opacity="0.7" />

      {/* §2.1 Faceplate (round, brushed copper) + seams y=24 / y=46 / centerline */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-face)`} />
      <path d="M16 24 Q32 22.6, 48 24" fill="none" stroke="#3a1810" strokeWidth="0.5" opacity="0.55" />
      <path d="M16 46 Q32 47.4, 48 46" fill="none" stroke="#3a1810" strokeWidth="0.5" opacity="0.55" />
      <line x1="32" y1="24" x2="32" y2="46" stroke="#3a1810" strokeWidth="0.4" opacity="0.4" />

      {/* §2.2 Panel fasteners */}
      <g>
        <circle cx="19.5" cy="22.5" r="0.95" fill="#2a1408" />
        <line x1="18.85" y1="22.5" x2="20.15" y2="22.5" stroke="#a06030" strokeWidth="0.45" />
        <circle cx="44.5" cy="22.5" r="0.95" fill="#2a1408" />
        <line x1="43.85" y1="22.5" x2="45.15" y2="22.5" stroke="#a06030" strokeWidth="0.45" />
        <circle cx="19.5" cy="46" r="0.95" fill="#2a1408" />
        <line x1="18.85" y1="46" x2="20.15" y2="46" stroke="#a06030" strokeWidth="0.45" />
        <circle cx="44.5" cy="46" r="0.95" fill="#2a1408" />
        <line x1="43.85" y1="46" x2="45.15" y2="46" stroke="#a06030" strokeWidth="0.45" />
      </g>

      {/* §2.3 Eye optics — amber pupils (operator override of §4.1 accent) */}
      <EyeOptics
        size={size}
        socketFill="#1a0808"
        bezelStroke="#c8866a"
        irisFill="#3a1810"
        irisStroke="#1a0808"
        pupilFill="#e89020"
        highlightFill="#ffe0a0"
        crosshairStroke="#1a0808"
      />

      {/* §2.6 Cheek speaker mesh */}
      <g>
        <circle cx="18" cy="40" r="1.7" fill="none" stroke="#3a1810" strokeWidth="0.4" opacity="0.65" />
        <circle cx="18" cy="40" r="1.1" fill="none" stroke="#3a1810" strokeWidth="0.35" opacity="0.55" />
        <circle cx="18" cy="40" r="0.4" fill="#3a1810" opacity="0.75" />
        <circle cx="46" cy="40" r="1.7" fill="none" stroke="#3a1810" strokeWidth="0.4" opacity="0.65" />
        <circle cx="46" cy="40" r="1.1" fill="none" stroke="#3a1810" strokeWidth="0.35" opacity="0.55" />
        <circle cx="46" cy="40" r="0.4" fill="#3a1810" opacity="0.75" />
      </g>

      {/* §2.5 Vent grille + LED dot row */}
      <g>
        <circle cx="29" cy="40.6" r="0.32" fill="#c84030" opacity="0.75" />
        <circle cx="32" cy="40.6" r="0.32" fill="#c84030" opacity="0.75" />
        <circle cx="35" cy="40.6" r="0.32" fill="#c84030" opacity="0.75" />
        <rect x="28" y="42" width="8" height="0.7" rx="0.2" fill="#3a1810" opacity="0.7" />
        <rect x="28" y="43.5" width="8" height="0.7" rx="0.2" fill="#3a1810" opacity="0.7" />
        <rect x="28" y="45" width="8" height="0.7" rx="0.2" fill="#3a1810" opacity="0.7" />
      </g>

      {/* §2.7 Anisotropic top-edge sheen */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-sheen)`} />
    </svg>
  );
}
