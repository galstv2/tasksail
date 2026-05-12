// Dalton — Software Engineer — robot-sprite-grammar-v1 §4.3 — gunmetal blocky chassis, red-orange accent, single antenna (male) through 5-spike heatsink fin array, mechanical headphones with audio jack

import { EyeOptics } from './EyeOptics';

export function DaltonSprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'dalton-r';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7a7a8a" />
          <stop offset="50%" stopColor="#4e4e5a" />
          <stop offset="100%" stopColor="#26262e" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="30%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={`${id}-shell`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3a3a48" />
          <stop offset="100%" stopColor="#0e0e16" />
        </linearGradient>
        <radialGradient id={`${id}-tip`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffd0a0" />
          <stop offset="60%" stopColor="#ff5040" />
          <stop offset="100%" stopColor="#7a1810" />
        </radialGradient>
        <linearGradient id={`${id}-cup`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#5a5a68" />
          <stop offset="100%" stopColor="#2a2a34" />
        </linearGradient>
      </defs>

      {/* §2.8 Headshell back */}
      <rect x="7" y="6" width="50" height="38" rx="6" fill={`url(#${id}-shell)`} />

      {/* §4.3 5-spike heatsink fin array */}
      <g>
        <path d="M11 14 L13 4 L15 14 Z" fill={`url(#${id}-shell)`} stroke="#0e0e16" strokeWidth="0.4" />
        <line x1="13" y1="6" x2="13" y2="13" stroke="#5a5a68" strokeWidth="0.3" opacity="0.5" />
        <path d="M17 14 L20 2 L23 14 Z" fill={`url(#${id}-shell)`} stroke="#0e0e16" strokeWidth="0.4" />
        <line x1="20" y1="4" x2="20" y2="13" stroke="#5a5a68" strokeWidth="0.3" opacity="0.5" />
        <path d="M25 14 L29 8 L29 14 Z" fill={`url(#${id}-shell)`} stroke="#0e0e16" strokeWidth="0.4" />
        <path d="M35 14 L35 8 L39 14 Z" fill={`url(#${id}-shell)`} stroke="#0e0e16" strokeWidth="0.4" />
        <path d="M41 14 L44 2 L47 14 Z" fill={`url(#${id}-shell)`} stroke="#0e0e16" strokeWidth="0.4" />
        <line x1="44" y1="4" x2="44" y2="13" stroke="#5a5a68" strokeWidth="0.3" opacity="0.5" />
        <path d="M49 14 L51 4 L53 14 Z" fill={`url(#${id}-shell)`} stroke="#0e0e16" strokeWidth="0.4" />
        <line x1="51" y1="6" x2="51" y2="13" stroke="#5a5a68" strokeWidth="0.3" opacity="0.5" />
        <line x1="9" y1="14" x2="55" y2="14" stroke="#5a5a68" strokeWidth="0.4" opacity="0.45" />
      </g>

      {/* §2.4 Single central antenna (male) */}
      <g>
        <circle cx="32" cy="2.5" r="2.0" fill={`url(#${id}-tip)`} stroke="#7a1810" strokeWidth="0.4" />
        <circle cx="31.4" cy="1.9" r="0.55" fill="#fff0d8" opacity="0.95" />
        <line x1="32" y1="5" x2="32" y2="9" stroke="#1a1a22" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="32" cy="5" r="0.55" fill="#0e0e16" />
        <circle cx="32" cy="9" r="0.55" fill="#0e0e16" />
        <line x1="32" y1="9.5" x2="32" y2="10.8" stroke="#1a1a22" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="32" cy="10.8" r="0.5" fill="#0e0e16" />
        <line x1="32" y1="11.3" x2="32" y2="12.6" stroke="#1a1a22" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="29.8" y="12.6" width="4.4" height="1.7" rx="0.3" fill="#0e0e16" stroke="#3a3a48" strokeWidth="0.3" />
        <circle cx="30.4" cy="13.45" r="0.32" fill="#5a5a68" />
        <circle cx="33.6" cy="13.45" r="0.32" fill="#5a5a68" />
      </g>

      {/* §2.1 Faceplate */}
      <rect x="12" y="16" width="40" height="36" rx="3" fill={`url(#${id}-face)`} />
      <line x1="14" y1="24" x2="50" y2="24" stroke="#1a1a22" strokeWidth="0.5" opacity="0.55" />
      <line x1="14" y1="46" x2="50" y2="46" stroke="#1a1a22" strokeWidth="0.5" opacity="0.55" />
      <line x1="32" y1="24" x2="32" y2="46" stroke="#1a1a22" strokeWidth="0.4" opacity="0.4" />

      {/* §2.2 Panel fasteners */}
      <g>
        <circle cx="15" cy="19" r="0.95" fill="#0e0e16" />
        <line x1="14.35" y1="19" x2="15.65" y2="19" stroke="#7a7a8a" strokeWidth="0.45" />
        <circle cx="49" cy="19" r="0.95" fill="#0e0e16" />
        <line x1="48.35" y1="19" x2="49.65" y2="19" stroke="#7a7a8a" strokeWidth="0.45" />
        <circle cx="15" cy="49" r="0.95" fill="#0e0e16" />
        <line x1="14.35" y1="49" x2="15.65" y2="49" stroke="#7a7a8a" strokeWidth="0.45" />
        <circle cx="49" cy="49" r="0.95" fill="#0e0e16" />
        <line x1="48.35" y1="49" x2="49.65" y2="49" stroke="#7a7a8a" strokeWidth="0.45" />
      </g>

      {/* §4.3 Headphones with audio jack */}
      <g>
        <path d="M10 28 Q10 14, 32 12 Q54 14, 54 28" fill="none" stroke="#3a3a48" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M10 28 Q10 14, 32 12 Q54 14, 54 28" fill="none" stroke="#5a5a68" strokeWidth="0.4" strokeLinecap="round" opacity="0.6" />
        <rect x="4.5" y="24" width="9" height="13" rx="2" fill={`url(#${id}-cup)`} stroke="#0e0e16" strokeWidth="0.4" />
        <rect x="6.5" y="26" width="5" height="9" rx="1.5" fill="#1a1a22" />
        <circle cx="9" cy="30.5" r="0.4" fill="#ff5040" opacity="0.9" />
        <line x1="6.5" y1="30.5" x2="11.5" y2="30.5" stroke="#0e0e16" strokeWidth="0.3" opacity="0.5" />
        <rect x="50.5" y="24" width="9" height="13" rx="2" fill={`url(#${id}-cup)`} stroke="#0e0e16" strokeWidth="0.4" />
        <rect x="52.5" y="26" width="5" height="9" rx="1.5" fill="#1a1a22" />
        <circle cx="55" cy="30.5" r="0.4" fill="#ff5040" opacity="0.9" />
        <line x1="52.5" y1="30.5" x2="57.5" y2="30.5" stroke="#0e0e16" strokeWidth="0.3" opacity="0.5" />
        <path d="M5 35 Q3 40, 5 46" fill="none" stroke="#1a1a22" strokeWidth="0.7" strokeLinecap="round" />
        <rect x="3.6" y="46" width="2.8" height="3.2" rx="0.4" fill="#3a3a48" stroke="#0e0e16" strokeWidth="0.3" />
        <line x1="4" y1="47" x2="6" y2="47" stroke="#7a7a8a" strokeWidth="0.3" />
        <line x1="4" y1="48" x2="6" y2="48" stroke="#7a7a8a" strokeWidth="0.3" />
      </g>

      {/* §2.3 Eye optics */}
      <EyeOptics
        size={size}
        socketFill="#0e0e16"
        bezelStroke="#7a7a8a"
        irisFill="#1a1a22"
        irisStroke="#0e0e16"
        pupilFill="#ff5040"
        highlightFill="#ffd0b0"
        crosshairStroke="#0e0e16"
      />

      {/* §2.6 Cheek speaker mesh */}
      <g>
        <circle cx="17" cy="40" r="1.7" fill="none" stroke="#1a1a22" strokeWidth="0.4" opacity="0.7" />
        <circle cx="17" cy="40" r="1.1" fill="none" stroke="#1a1a22" strokeWidth="0.35" opacity="0.6" />
        <circle cx="17" cy="40" r="0.4" fill="#0e0e16" opacity="0.85" />
        <circle cx="47" cy="40" r="1.7" fill="none" stroke="#1a1a22" strokeWidth="0.4" opacity="0.7" />
        <circle cx="47" cy="40" r="1.1" fill="none" stroke="#1a1a22" strokeWidth="0.35" opacity="0.6" />
        <circle cx="47" cy="40" r="0.4" fill="#0e0e16" opacity="0.85" />
      </g>

      {/* §2.5 Vent grille + LED dot row */}
      <g>
        <circle cx="29" cy="40.6" r="0.32" fill="#ff5040" opacity="0.85" />
        <circle cx="32" cy="40.6" r="0.32" fill="#ff5040" opacity="0.85" />
        <circle cx="35" cy="40.6" r="0.32" fill="#ff5040" opacity="0.85" />
        <rect x="28" y="42" width="8" height="0.7" rx="0.2" fill="#0e0e16" opacity="0.85" />
        <rect x="28" y="43.5" width="8" height="0.7" rx="0.2" fill="#0e0e16" opacity="0.85" />
        <rect x="28" y="45" width="8" height="0.7" rx="0.2" fill="#0e0e16" opacity="0.85" />
      </g>

      {/* §2.7 Sheen */}
      <rect x="12" y="16" width="40" height="36" rx="3" fill={`url(#${id}-sheen)`} />
    </svg>
  );
}
