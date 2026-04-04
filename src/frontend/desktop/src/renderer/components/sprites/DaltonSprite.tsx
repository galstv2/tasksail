// Dalton — Software Engineer — Funko Pop: blocky/squared head, spiky dark hair, headphones, half-lidded smirk

export function DaltonSprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'dalton-pop';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-skin`} cx="42%" cy="36%" r="52%">
          <stop offset="0%" stopColor="#f0c898" />
          <stop offset="70%" stopColor="#e0b480" />
          <stop offset="100%" stopColor="#d0a068" />
        </radialGradient>
        <radialGradient id={`${id}-shine`} cx="32%" cy="22%" r="38%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id={`${id}-hair`} cx="42%" cy="26%" r="55%">
          <stop offset="0%" stopColor="#3a2a18" />
          <stop offset="60%" stopColor="#261808" />
          <stop offset="100%" stopColor="#140a00" />
        </radialGradient>
      </defs>

      {/* Hair back — blocky shape */}
      <rect x="7" y="6" width="50" height="38" rx="8" fill={`url(#${id}-hair)`} />

      {/* Face — blocky/squared (male) with rounded corners */}
      <rect x="12" y="16" width="40" height="36" rx="6" fill={`url(#${id}-skin)`} />

      {/* Spiky hair — aggressive upward spikes */}
      <path d="M12 18 L10 6 L18 14 L20 2 L26 12 L32 0 L38 12 L44 2 L46 14 L54 6 L52 18Z" fill={`url(#${id}-hair)`} />
      {/* Hair side blocks */}
      <rect x="7" y="14" width="7" height="14" rx="2" fill="#1a0c00" opacity="0.6" />
      <rect x="50" y="14" width="7" height="14" rx="2" fill="#1a0c00" opacity="0.6" />

      {/* Headphone band */}
      <path d="M10 28 Q10 10, 32 8 Q54 10, 54 28" fill="none" stroke="#4a4a5a" strokeWidth="2.8" strokeLinecap="round" />
      {/* Ear pads */}
      <rect x="5" y="24" width="8" height="12" rx="3" fill="#4a4a5a" />
      <rect x="51" y="24" width="8" height="12" rx="3" fill="#4a4a5a" />
      {/* Pad detail */}
      <rect x="7" y="26" width="4" height="8" rx="2" fill="#5a5a6a" />
      <rect x="53" y="26" width="4" height="8" rx="2" fill="#5a5a6a" />
      {/* Pad highlight */}
      <path d="M8 27 L8 31" stroke="#6a6a7a" strokeWidth="0.6" opacity="0.5" />
      <path d="M56 27 L56 31" stroke="#6a6a7a" strokeWidth="0.6" opacity="0.5" />

      {/* Eyebrows — angular, focused */}
      <path d="M19 28 L28 26" fill="none" stroke="#261808" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <path d="M36 26 L45 28" fill="none" stroke="#261808" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />

      {/* Eyes — half-lidded (elongated ovals) */}
      <ellipse cx="24" cy="33" rx="3.8" ry="2.6" fill="#1a1a2e" />
      <ellipse cx="40" cy="33" rx="3.8" ry="2.6" fill="#1a1a2e" />
      {/* Eyelids — heavy lids for that focused/chill look */}
      <path d="M19.5 31.5 Q24 29, 28.5 31.5" fill={`url(#${id}-skin)`} />
      <path d="M35.5 31.5 Q40 29, 44.5 31.5" fill={`url(#${id}-skin)`} />
      {/* Eye highlights */}
      <circle cx="25.5" cy="32.5" r="1" fill="white" opacity="0.8" />
      <circle cx="41.5" cy="32.5" r="1" fill="white" opacity="0.8" />

      {/* Nose hint */}
      <path d="M31 38 L33 38" stroke="#d0a068" strokeWidth="1" strokeLinecap="round" opacity="0.4" />

      {/* Smirk — asymmetric, one side up */}
      <path d="M27 44 Q33 47, 38 42" fill="none" stroke="#c08060" strokeWidth="1.4" strokeLinecap="round" />

      {/* Jawline shadow — emphasize blocky shape */}
      <path d="M14 48 Q32 54, 50 48" fill="none" stroke="#c09058" strokeWidth="0.8" opacity="0.2" />

      {/* Vinyl sheen */}
      <rect x="12" y="16" width="40" height="36" rx="6" fill={`url(#${id}-shine)`} />
    </svg>
  );
}
