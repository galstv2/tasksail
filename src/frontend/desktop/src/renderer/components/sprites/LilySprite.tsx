// Lily — Planning Specialist — Funko Pop: round head, thick straight-cut bangs, auburn hair, big cute eyes, sweet smile

export function LilySprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'lily-pop';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-skin`} cx="42%" cy="36%" r="52%">
          <stop offset="0%" stopColor="#fcc8b0" />
          <stop offset="70%" stopColor="#f5b49a" />
          <stop offset="100%" stopColor="#e8a088" />
        </radialGradient>
        <radialGradient id={`${id}-shine`} cx="32%" cy="22%" r="38%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.38)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id={`${id}-hair`} cx="42%" cy="28%" r="55%">
          <stop offset="0%" stopColor="#9a4040" />
          <stop offset="60%" stopColor="#7a2828" />
          <stop offset="100%" stopColor="#5a1818" />
        </radialGradient>
      </defs>

      {/* Hair volume — round back */}
      <ellipse cx="32" cy="28" rx="25" ry="24" fill={`url(#${id}-hair)`} />

      {/* Face — round (female) */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-skin)`} />

      {/* Hair — center part, swept to both sides */}
      {/* Left side — sweeps from center part down and left */}
      <path d="M32 8 Q20 8, 14 14 Q10 20, 9 30 Q7 40, 10 52 Q13 44, 13 28 Q14 18, 22 12 Q28 9, 32 8Z" fill={`url(#${id}-hair)`} />
      {/* Right side — sweeps from center part down and right */}
      <path d="M32 8 Q44 8, 50 14 Q54 20, 55 30 Q57 40, 54 52 Q51 44, 51 28 Q50 18, 42 12 Q36 9, 32 8Z" fill={`url(#${id}-hair)`} />
      {/* Center part line */}
      <path d="M32 6 Q32 10, 32 16" stroke="#4a1414" strokeWidth="0.8" opacity="0.5" />
      {/* Hair flow lines — left side */}
      <path d="M28 10 Q18 16, 13 28" fill="none" stroke="#5a1818" strokeWidth="0.5" opacity="0.2" />
      <path d="M26 10 Q16 18, 11 34" fill="none" stroke="#5a1818" strokeWidth="0.5" opacity="0.2" />
      {/* Hair flow lines — right side */}
      <path d="M36 10 Q46 16, 51 28" fill="none" stroke="#5a1818" strokeWidth="0.5" opacity="0.2" />
      <path d="M38 10 Q48 18, 53 34" fill="none" stroke="#5a1818" strokeWidth="0.5" opacity="0.2" />
      {/* Highlights */}
      <path d="M24 12 Q18 18, 14 28" fill="none" stroke="#b05050" strokeWidth="0.7" opacity="0.3" />
      <path d="M40 12 Q46 18, 50 28" fill="none" stroke="#b05050" strokeWidth="0.7" opacity="0.3" />

      {/* Eyebrows — soft, slightly arched */}
      <path d="M19 28 Q24 26, 29 28" fill="none" stroke="#7a3030" strokeWidth="1.1" strokeLinecap="round" opacity="0.5" />
      <path d="M35 28 Q40 26, 45 28" fill="none" stroke="#7a3030" strokeWidth="1.1" strokeLinecap="round" opacity="0.5" />

      {/* Eyes — big, cute, anime-Funko hybrid */}
      <ellipse cx="24" cy="35" rx="4.5" ry="5" fill="#1a1a2e" />
      <ellipse cx="40" cy="35" rx="4.5" ry="5" fill="#1a1a2e" />
      {/* Iris color ring — warm brown */}
      <ellipse cx="24" cy="35.5" rx="3.2" ry="3.5" fill="#4a2828" />
      <ellipse cx="40" cy="35.5" rx="3.2" ry="3.5" fill="#4a2828" />
      {/* Pupil */}
      <circle cx="24" cy="36" r="2" fill="#1a1a2e" />
      <circle cx="40" cy="36" r="2" fill="#1a1a2e" />
      {/* Primary highlight — large, upper-left */}
      <ellipse cx="26" cy="33.5" rx="1.8" ry="2" fill="white" opacity="0.95" />
      <ellipse cx="42" cy="33.5" rx="1.8" ry="2" fill="white" opacity="0.95" />
      {/* Secondary sparkle — small, lower-right */}
      <circle cx="22.5" cy="37" r="0.8" fill="white" opacity="0.6" />
      <circle cx="38.5" cy="37" r="0.8" fill="white" opacity="0.6" />
      {/* Bottom eye curve — cute rounded lower lid */}
      <path d="M19.5 38 Q24 40.5, 28.5 38" fill="none" stroke="#e8a088" strokeWidth="0.6" opacity="0.4" />
      <path d="M35.5 38 Q40 40.5, 44.5 38" fill="none" stroke="#e8a088" strokeWidth="0.6" opacity="0.4" />

      {/* Tiny eyelashes — just hints at the outer corners */}
      <path d="M19 33 L17.5 31.5" stroke="#1a1a2e" strokeWidth="0.7" strokeLinecap="round" opacity="0.4" />
      <path d="M45 33 L46.5 31.5" stroke="#1a1a2e" strokeWidth="0.7" strokeLinecap="round" opacity="0.4" />

      {/* Nose — tiny hint */}
      <ellipse cx="32" cy="40" rx="1.2" ry="0.7" fill="#e8a088" opacity="0.5" />

      {/* Blush — rosy cheeks */}
      <ellipse cx="18" cy="40" rx="4.5" ry="3" fill="#f0a0a0" opacity="0.35" />
      <ellipse cx="46" cy="40" rx="4.5" ry="3" fill="#f0a0a0" opacity="0.35" />

      {/* Smile — sweet small curve */}
      <path d="M28 45 Q32 49, 36 45" fill="none" stroke="#c06060" strokeWidth="1.3" strokeLinecap="round" />
      {/* Lip highlight */}
      <path d="M30 46 Q32 47.5, 34 46" fill="none" stroke="#d88080" strokeWidth="0.5" opacity="0.4" />

      {/* Vinyl sheen overlay */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-shine)`} />
    </svg>
  );
}
