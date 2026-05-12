// Alice — Product Manager — robot-sprite-grammar-v1 §4.2 — polished brass round chassis, soft-magenta accent, dual antennas (female), right-leaning data-fin, one-piece visor lens bar

import { EyeOptics } from './EyeOptics';

export function AliceSprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'alice-r';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f4dca0" />
          <stop offset="50%" stopColor="#d8b870" />
          <stop offset="100%" stopColor="#947638" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.36)" />
          <stop offset="30%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={`${id}-shell`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#c8a058" />
          <stop offset="100%" stopColor="#7a5828" />
        </linearGradient>
        <radialGradient id={`${id}-tip`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffe0ec" />
          <stop offset="60%" stopColor="#e0588c" />
          <stop offset="100%" stopColor="#7a1840" />
        </radialGradient>
        <linearGradient id={`${id}-visor`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(20,40,80,0.42)" />
          <stop offset="100%" stopColor="rgba(20,40,80,0.18)" />
        </linearGradient>
        <clipPath id={`${id}-face-clip`}>
          <circle cx="32" cy="34" r="18.5" />
        </clipPath>
      </defs>

      {/* §2.4 Antennas — TWO (female) */}
      <g>
        <circle cx="20" cy="2.5" r="2.0" fill={`url(#${id}-tip)`} stroke="#7a1840" strokeWidth="0.4" />
        <circle cx="19.4" cy="1.9" r="0.55" fill="#fff0f6" opacity="0.95" />
        <line x1="20" y1="5" x2="20" y2="9" stroke="#3a2c14" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="20" cy="5" r="0.55" fill="#1a1408" />
        <circle cx="20" cy="9" r="0.55" fill="#1a1408" />
        <line x1="20" y1="9.5" x2="20" y2="10.8" stroke="#3a2c14" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="20" cy="10.8" r="0.5" fill="#1a1408" />
        <line x1="20" y1="11.3" x2="20" y2="12.6" stroke="#3a2c14" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="17.8" y="12.6" width="4.4" height="1.7" rx="0.3" fill="#2a1c08" stroke="#5a4018" strokeWidth="0.3" />
        <circle cx="18.4" cy="13.45" r="0.32" fill="#7a5a2c" />
        <circle cx="21.6" cy="13.45" r="0.32" fill="#7a5a2c" />
        <circle cx="44" cy="2.5" r="2.0" fill={`url(#${id}-tip)`} stroke="#7a1840" strokeWidth="0.4" />
        <circle cx="43.4" cy="1.9" r="0.55" fill="#fff0f6" opacity="0.95" />
        <line x1="44" y1="5" x2="44" y2="9" stroke="#3a2c14" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="44" cy="5" r="0.55" fill="#1a1408" />
        <circle cx="44" cy="9" r="0.55" fill="#1a1408" />
        <line x1="44" y1="9.5" x2="44" y2="10.8" stroke="#3a2c14" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="44" cy="10.8" r="0.5" fill="#1a1408" />
        <line x1="44" y1="11.3" x2="44" y2="12.6" stroke="#3a2c14" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="41.8" y="12.6" width="4.4" height="1.7" rx="0.3" fill="#2a1c08" stroke="#5a4018" strokeWidth="0.3" />
        <circle cx="42.4" cy="13.45" r="0.32" fill="#7a5a2c" />
        <circle cx="45.6" cy="13.45" r="0.32" fill="#7a5a2c" />
      </g>

      {/* §2.8 Headshell with faceted side panels */}
      <ellipse cx="32" cy="28" rx="25" ry="24" fill={`url(#${id}-shell)`} />
      <path d="M32 8 L18 12 L11 22 L8 36 L11 50 L13 42 L13 28 L18 16 L26 11 Z" fill={`url(#${id}-shell)`} />
      <path d="M32 8 L46 12 L53 22 L56 36 L53 50 L51 42 L51 28 L46 16 L38 11 Z" fill={`url(#${id}-shell)`} />

      {/* §4.2 Right-leaning data-fin */}
      <path d="M38 13 L54 17 L52 27 L42 22 Z" fill={`url(#${id}-shell)`} stroke="#1a1408" strokeWidth="0.55" />
      <line x1="42" y1="16" x2="50" y2="22" stroke="#1a1408" strokeWidth="0.35" opacity="0.5" />
      <line x1="40" y1="14" x2="52" y2="17" stroke="rgba(255,240,200,0.34)" strokeWidth="0.45" />

      <path d="M14 18 L13 32" stroke="#1a1408" strokeWidth="0.5" opacity="0.55" />
      <path d="M11 38 L12 48" stroke="#1a1408" strokeWidth="0.4" opacity="0.45" />
      <path d="M50 18 L51 32" stroke="#1a1408" strokeWidth="0.5" opacity="0.55" />
      <line x1="32" y1="6" x2="32" y2="16" stroke="#1a1408" strokeWidth="0.7" opacity="0.7" />

      {/* §2.1 Faceplate (round, brushed brass) + seams */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-face)`} />
      <path d="M16 24 Q32 22.6, 48 24" fill="none" stroke="#3a2c14" strokeWidth="0.5" opacity="0.55" />
      <path d="M16 46 Q32 47.4, 48 46" fill="none" stroke="#3a2c14" strokeWidth="0.5" opacity="0.55" />
      <line x1="32" y1="24" x2="32" y2="46" stroke="#3a2c14" strokeWidth="0.4" opacity="0.4" />

      {/* §2.2 Panel fasteners */}
      <g>
        <circle cx="19.5" cy="22.5" r="0.95" fill="#2a1c08" />
        <line x1="18.85" y1="22.5" x2="20.15" y2="22.5" stroke="#c8a058" strokeWidth="0.45" />
        <circle cx="44.5" cy="22.5" r="0.95" fill="#2a1c08" />
        <line x1="43.85" y1="22.5" x2="45.15" y2="22.5" stroke="#c8a058" strokeWidth="0.45" />
        <circle cx="19.5" cy="46" r="0.95" fill="#2a1c08" />
        <line x1="18.85" y1="46" x2="20.15" y2="46" stroke="#c8a058" strokeWidth="0.45" />
        <circle cx="44.5" cy="46" r="0.95" fill="#2a1c08" />
        <line x1="43.85" y1="46" x2="45.15" y2="46" stroke="#c8a058" strokeWidth="0.45" />
      </g>

      {/* §2.3 Eye optics — magenta pupils */}
      <EyeOptics
        size={size}
        socketFill="#1a1408"
        bezelStroke="#d8b870"
        irisFill="#3a2c14"
        irisStroke="#1a1408"
        pupilFill="#e0588c"
        highlightFill="#ffd0e0"
        crosshairStroke="#1a1408"
      />

      {/* §4.2 One-piece visor lens bar */}
      <g clipPath={`url(#${id}-face-clip)`}>
        <rect x="14" y="29.5" width="36" height="7" rx="2.5" fill={`url(#${id}-visor)`} stroke="#1a1408" strokeWidth="0.7" />
        <line x1="14" y1="30.5" x2="50" y2="30.5" stroke="rgba(255,255,255,0.32)" strokeWidth="0.5" />
        <line x1="14" y1="35.5" x2="50" y2="35.5" stroke="rgba(0,0,0,0.18)" strokeWidth="0.4" />
        <line x1="29" y1="33" x2="35" y2="33" stroke="#e0588c" strokeWidth="0.4" opacity="0.7" />
      </g>

      {/* §2.6 Cheek speaker mesh */}
      <g>
        <circle cx="18" cy="40" r="1.7" fill="none" stroke="#3a2c14" strokeWidth="0.4" opacity="0.65" />
        <circle cx="18" cy="40" r="1.1" fill="none" stroke="#3a2c14" strokeWidth="0.35" opacity="0.55" />
        <circle cx="18" cy="40" r="0.4" fill="#3a2c14" opacity="0.75" />
        <circle cx="46" cy="40" r="1.7" fill="none" stroke="#3a2c14" strokeWidth="0.4" opacity="0.65" />
        <circle cx="46" cy="40" r="1.1" fill="none" stroke="#3a2c14" strokeWidth="0.35" opacity="0.55" />
        <circle cx="46" cy="40" r="0.4" fill="#3a2c14" opacity="0.75" />
      </g>

      {/* §2.5 Vent grille + LED dot row */}
      <g>
        <circle cx="29" cy="40.6" r="0.32" fill="#e0588c" opacity="0.8" />
        <circle cx="32" cy="40.6" r="0.32" fill="#e0588c" opacity="0.8" />
        <circle cx="35" cy="40.6" r="0.32" fill="#e0588c" opacity="0.8" />
        <rect x="28" y="42" width="8" height="0.7" rx="0.2" fill="#3a2c14" opacity="0.7" />
        <rect x="28" y="43.5" width="8" height="0.7" rx="0.2" fill="#3a2c14" opacity="0.7" />
        <rect x="28" y="45" width="8" height="0.7" rx="0.2" fill="#3a2c14" opacity="0.7" />
      </g>

      {/* §2.7 Sheen */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-sheen)`} />
    </svg>
  );
}
