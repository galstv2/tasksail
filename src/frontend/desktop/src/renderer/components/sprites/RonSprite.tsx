// Ron — QA and Closeout — Funko Pop: blocky head, baseball cap, brass monocle + chain, hazelnut skin, composed

export function RonSprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'ron-pop';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-skin`} cx="42%" cy="36%" r="52%">
          <stop offset="0%" stopColor="#d4a07c" />
          <stop offset="70%" stopColor="#c48c6c" />
          <stop offset="100%" stopColor="#ac7c5c" />
        </radialGradient>
        <radialGradient id={`${id}-shine`} cx="32%" cy="22%" r="38%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <linearGradient id={`${id}-cap`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4a2868" />
          <stop offset="100%" stopColor="#341a50" />
        </linearGradient>
        <linearGradient id={`${id}-brim`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#341a50" />
          <stop offset="100%" stopColor="#281040" />
        </linearGradient>
        <linearGradient id={`${id}-monocle`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd040" />
          <stop offset="50%" stopColor="#e8b020" />
          <stop offset="100%" stopColor="#c89010" />
        </linearGradient>
      </defs>

      {/* Face — blocky/squared (male) */}
      <rect x="12" y="18" width="40" height="35" rx="6" fill={`url(#${id}-skin)`} />

      {/* Hair peeking out under cap — short sides */}
      <rect x="10" y="18" width="6" height="8" rx="2" fill="#1a1420" opacity="0.7" />
      <rect x="48" y="18" width="6" height="8" rx="2" fill="#1a1420" opacity="0.7" />

      {/* Baseball cap — crown */}
      <path d="M10 20 Q10 4, 32 4 Q54 4, 54 20 Z" fill={`url(#${id}-cap)`} />
      {/* Cap panel seams */}
      <path d="M32 4 L32 20" stroke="#1a3450" strokeWidth="0.6" opacity="0.4" />
      <path d="M22 5 Q22 12, 22 20" stroke="#1a3450" strokeWidth="0.4" opacity="0.25" />
      <path d="M42 5 Q42 12, 42 20" stroke="#1a3450" strokeWidth="0.4" opacity="0.25" />
      {/* Cap button on top */}
      <circle cx="32" cy="5" r="1.8" fill="#341a50" />
      <circle cx="32" cy="5" r="1" fill="#4a2868" />
      {/* Cap highlight */}
      <path d="M18 10 Q26 6, 38 8" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

      {/* Brim — flat, extends forward */}
      <path d="M6 20 Q8 16, 14 18 L50 18 Q56 16, 58 20 Q56 22, 50 21 L14 21 Q8 22, 6 20Z" fill={`url(#${id}-brim)`} />
      {/* Brim edge highlight */}
      <path d="M10 19 Q32 17, 54 19" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
      {/* Brim underside shadow on face */}
      <path d="M14 21 L50 21" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />

      {/* Eyebrows — level, composed */}
      <path d="M19 28 Q24 26.5, 28 28" fill="none" stroke="#1a1420" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
      <path d="M36 28 Q40 26.5, 45 28" fill="none" stroke="#1a1420" strokeWidth="1" strokeLinecap="round" opacity="0.5" />

      {/* Eyes */}
      <circle cx="24" cy="33" r="3.4" fill="#1a1a2e" />
      <circle cx="40" cy="33" r="3.4" fill="#1a1a2e" />
      {/* Eye highlights */}
      <circle cx="25.3" cy="31.8" r="1.2" fill="white" opacity="0.9" />
      <circle cx="41.3" cy="31.8" r="1.2" fill="white" opacity="0.9" />
      <circle cx="22.8" cy="34" r="0.5" fill="white" opacity="0.4" />
      <circle cx="38.8" cy="34" r="0.5" fill="white" opacity="0.4" />

      {/* Monocle — brass ring on right eye */}
      <circle cx="40" cy="33" r="7" fill="none" stroke={`url(#${id}-monocle)`} strokeWidth="2.2" />
      {/* Monocle highlight */}
      <path d="M35 28.5 Q37 27, 39 27.5" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
      {/* Monocle chain */}
      <path d="M40 40 Q43 44, 41 48 Q39 52, 36 54" fill="none" stroke="#e8b020" strokeWidth="0.8" strokeLinecap="round" opacity="0.6" />
      <circle cx="42" cy="45" r="0.5" fill="#e8b020" opacity="0.4" />
      <circle cx="40" cy="50" r="0.5" fill="#e8b020" opacity="0.4" />

      {/* Nose hint */}
      <path d="M31 38 L33 38" stroke="#ac7c5c" strokeWidth="0.9" strokeLinecap="round" opacity="0.35" />

      {/* Composed smile */}
      <path d="M27 44 Q32 47, 37 44" fill="none" stroke="#906848" strokeWidth="1.3" strokeLinecap="round" />

      {/* Jawline shadow */}
      <path d="M14 49 Q32 55, 50 49" fill="none" stroke="#987058" strokeWidth="0.7" opacity="0.2" />

      {/* Vinyl sheen */}
      <rect x="12" y="18" width="40" height="35" rx="6" fill={`url(#${id}-shine)`} />
    </svg>
  );
}
