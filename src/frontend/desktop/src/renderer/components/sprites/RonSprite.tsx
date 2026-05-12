// Ron — QA — robot-sprite-grammar-v1 §4.5 — bronze blocky chassis, brass-yellow accent, single antenna (male) from cap crown bolt, baseball cap + reticle monocle

import { EyeOptics } from './EyeOptics';

export function RonSprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'ron-r';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#d8a078" />
          <stop offset="50%" stopColor="#a8784c" />
          <stop offset="100%" stopColor="#6a4828" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
          <stop offset="30%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={`${id}-cap`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4a2868" />
          <stop offset="100%" stopColor="#2a1448" />
        </linearGradient>
        <linearGradient id={`${id}-brim`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#341a50" />
          <stop offset="100%" stopColor="#1a0832" />
        </linearGradient>
        <radialGradient id={`${id}-tip`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fff0a0" />
          <stop offset="60%" stopColor="#ffc840" />
          <stop offset="100%" stopColor="#7a5810" />
        </radialGradient>
        <linearGradient id={`${id}-monocle`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd860" />
          <stop offset="50%" stopColor="#e0a830" />
          <stop offset="100%" stopColor="#a87010" />
        </linearGradient>
      </defs>

      {/* §2.1 Faceplate (blocky, brushed bronze) */}
      <rect x="12" y="18" width="40" height="35" rx="3" fill={`url(#${id}-face)`} />

      {/* Side ear panels */}
      <rect x="10" y="18" width="6" height="8" rx="1.5" fill="#26180e" opacity="0.72" />
      <rect x="48" y="18" width="6" height="8" rx="1.5" fill="#26180e" opacity="0.72" />

      {/* §4.5 Baseball cap */}
      <path d="M10 20 Q10 8, 32 8 Q54 8, 54 20 Z" fill={`url(#${id}-cap)`} />
      <line x1="32" y1="8" x2="32" y2="20" stroke="#1a0832" strokeWidth="0.5" opacity="0.55" />
      <path d="M22 9 Q22 14, 22 20" stroke="#1a0832" strokeWidth="0.4" fill="none" opacity="0.4" />
      <path d="M42 9 Q42 14, 42 20" stroke="#1a0832" strokeWidth="0.4" fill="none" opacity="0.4" />
      <path d="M14 14 Q14 16, 14 20" stroke="#1a0832" strokeWidth="0.3" fill="none" opacity="0.3" />
      <path d="M50 14 Q50 16, 50 20" stroke="#1a0832" strokeWidth="0.3" fill="none" opacity="0.3" />

      {/* Cap button = §2.4 antenna base flange */}
      <circle cx="32" cy="8.5" r="1.6" fill="#1a0832" stroke="#4a2868" strokeWidth="0.3" />
      <circle cx="31" cy="8" r="0.32" fill="#3a1c50" />
      <circle cx="33" cy="8" r="0.32" fill="#3a1c50" />

      {/* §2.4 Single antenna (male), brass-yellow tip */}
      <g>
        <circle cx="32" cy="2.5" r="1.9" fill={`url(#${id}-tip)`} stroke="#7a5810" strokeWidth="0.4" />
        <circle cx="31.4" cy="1.9" r="0.55" fill="#fffce0" opacity="0.95" />
        <line x1="32" y1="4.7" x2="32" y2="6.4" stroke="#1a0832" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="32" cy="4.6" r="0.45" fill="#1a0832" />
        <circle cx="32" cy="6.5" r="0.45" fill="#1a0832" />
        <line x1="32" y1="6.7" x2="32" y2="7.5" stroke="#1a0832" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="32" cy="7.6" r="0.4" fill="#1a0832" />
        <line x1="32" y1="7.8" x2="32" y2="8.4" stroke="#1a0832" strokeWidth="1.2" strokeLinecap="round" />
      </g>

      {/* Cap highlight */}
      <path d="M18 12 Q26 9, 38 11" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" />

      {/* §4.5 Brim */}
      <path d="M6 20 Q8 16, 14 18 L50 18 Q56 16, 58 20 Q56 22, 50 21 L14 21 Q8 22, 6 20Z" fill={`url(#${id}-brim)`} />
      <path d="M10 19 Q32 17, 54 19" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
      <line x1="14" y1="21" x2="50" y2="21" stroke="rgba(0,0,0,0.18)" strokeWidth="1.4" />

      {/* §2.1 seams */}
      <line x1="14" y1="24" x2="50" y2="24" stroke="#26180e" strokeWidth="0.5" opacity="0.55" />
      <line x1="14" y1="46" x2="50" y2="46" stroke="#26180e" strokeWidth="0.5" opacity="0.55" />
      <line x1="32" y1="24" x2="32" y2="46" stroke="#26180e" strokeWidth="0.4" opacity="0.4" />

      {/* §2.2 Panel fasteners */}
      <g>
        <circle cx="15" cy="25" r="0.85" fill="#26180e" />
        <line x1="14.4" y1="25" x2="15.6" y2="25" stroke="#d8a078" strokeWidth="0.4" />
        <circle cx="49" cy="25" r="0.85" fill="#26180e" />
        <line x1="48.4" y1="25" x2="49.6" y2="25" stroke="#d8a078" strokeWidth="0.4" />
        <circle cx="15" cy="50" r="0.95" fill="#26180e" />
        <line x1="14.35" y1="50" x2="15.65" y2="50" stroke="#d8a078" strokeWidth="0.45" />
        <circle cx="49" cy="50" r="0.95" fill="#26180e" />
        <line x1="48.35" y1="50" x2="49.65" y2="50" stroke="#d8a078" strokeWidth="0.45" />
      </g>

      {/* §2.3 Eye optics — brass-yellow pupils */}
      <EyeOptics
        size={size}
        socketFill="#1a0c08"
        bezelStroke="#c8966a"
        irisFill="#3a2410"
        irisStroke="#1a0c08"
        pupilFill="#ffc840"
        highlightFill="#fff8d8"
        crosshairStroke="#1a0c08"
      />

      {/* §4.5 Inspection-lens monocle with reticle crosshairs */}
      <g>
        <circle cx="40" cy="33" r="7" fill="rgba(255,240,180,0.06)" stroke={`url(#${id}-monocle)`} strokeWidth="2" />
        <circle cx="40" cy="33" r="7" fill="none" stroke="#7a5810" strokeWidth="0.4" opacity="0.5" />
        <line x1="33.5" y1="33" x2="46.5" y2="33" stroke="#7a5810" strokeWidth="0.35" opacity="0.6" />
        <line x1="40" y1="26.5" x2="40" y2="39.5" stroke="#7a5810" strokeWidth="0.35" opacity="0.6" />
        <line x1="36" y1="32.4" x2="36" y2="33.6" stroke="#7a5810" strokeWidth="0.3" opacity="0.55" />
        <line x1="44" y1="32.4" x2="44" y2="33.6" stroke="#7a5810" strokeWidth="0.3" opacity="0.55" />
        <line x1="39.4" y1="29" x2="40.6" y2="29" stroke="#7a5810" strokeWidth="0.3" opacity="0.55" />
        <line x1="39.4" y1="37" x2="40.6" y2="37" stroke="#7a5810" strokeWidth="0.3" opacity="0.55" />
        <path d="M35 28.5 Q37 27, 39 27.6" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="0.7" />
        <path d="M40 40 Q43 44, 41 48 Q39 52, 36 54" fill="none" stroke="#e0a830" strokeWidth="0.7" strokeLinecap="round" opacity="0.65" />
        <circle cx="42" cy="45" r="0.45" fill="#e0a830" opacity="0.6" />
        <circle cx="40" cy="50" r="0.45" fill="#e0a830" opacity="0.6" />
      </g>

      {/* §2.6 Cheek speaker mesh (left only; right covered by monocle) */}
      <g>
        <circle cx="18" cy="40" r="1.7" fill="none" stroke="#26180e" strokeWidth="0.4" opacity="0.65" />
        <circle cx="18" cy="40" r="1.1" fill="none" stroke="#26180e" strokeWidth="0.35" opacity="0.55" />
        <circle cx="18" cy="40" r="0.4" fill="#26180e" opacity="0.8" />
      </g>

      {/* §2.5 Vent grille + LED dot row */}
      <g>
        <circle cx="29" cy="40.6" r="0.32" fill="#ffc840" opacity="0.85" />
        <circle cx="32" cy="40.6" r="0.32" fill="#ffc840" opacity="0.85" />
        <circle cx="35" cy="40.6" r="0.32" fill="#ffc840" opacity="0.85" />
        <rect x="28" y="42" width="8" height="0.7" rx="0.2" fill="#26180e" opacity="0.75" />
        <rect x="28" y="43.5" width="8" height="0.7" rx="0.2" fill="#26180e" opacity="0.75" />
        <rect x="28" y="45" width="8" height="0.7" rx="0.2" fill="#26180e" opacity="0.75" />
      </g>

      {/* §2.7 Sheen */}
      <rect x="12" y="18" width="40" height="35" rx="3" fill={`url(#${id}-sheen)`} />
    </svg>
  );
}
