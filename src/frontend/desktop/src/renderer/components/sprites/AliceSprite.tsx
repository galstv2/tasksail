// Alice — Product Manager — Funko Pop: round head, dirty blonde side-swept hair, thin black glasses, blue eyes, fair skin

export function AliceSprite({ size = 36 }: { size?: number }): JSX.Element {
  const id = 'alice-pop';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-skin`} cx="42%" cy="36%" r="52%">
          <stop offset="0%" stopColor="#fce8d8" />
          <stop offset="70%" stopColor="#f5d8c0" />
          <stop offset="100%" stopColor="#e8c8b0" />
        </radialGradient>
        <radialGradient id={`${id}-shine`} cx="32%" cy="22%" r="38%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.36)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id={`${id}-hair`} cx="42%" cy="28%" r="55%">
          <stop offset="0%" stopColor="#b89868" />
          <stop offset="60%" stopColor="#9a7c4a" />
          <stop offset="100%" stopColor="#7c6238" />
        </radialGradient>
        <clipPath id={`${id}-face-clip`}>
          <circle cx="32" cy="34" r="18.5" />
        </clipPath>
      </defs>

      {/* Hair volume — swept right */}
      <ellipse cx="34" cy="27" rx="25" ry="23" fill={`url(#${id}-hair)`} />

      {/* Face — round (female) */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-skin)`} />

      {/* Hair sweep — left shorter, right longer but not droopy */}
      <path d="M12 24 Q15 8, 34 10 Q50 7, 54 24 Q52 12, 38 11 Q20 10, 12 24Z" fill={`url(#${id}-hair)`} />
      {/* Right side volume — shorter, youthful */}
      <path d="M50 22 Q55 30, 53 40 Q51 32, 50 26Z" fill="#7c6238" opacity="0.85" />
      {/* Hair highlights */}
      <path d="M20 13 Q28 10, 38 11" fill="none" stroke="#c8a870" strokeWidth="0.8" opacity="0.4" />

      {/* Eyebrows — soft arches */}
      <path d="M19 27 Q24 25, 29 27" fill="none" stroke="#6a5030" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <path d="M35 27 Q40 25, 45 27" fill="none" stroke="#6a5030" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />

      {/* Glasses temple arms — clipped to face so they hide behind hair */}
      <g clipPath={`url(#${id}-face-clip)`}>
        <path d="M17 33 L8 31 Q5 31, 5 34" stroke="#1a1a24" strokeWidth="0.9" strokeLinecap="round" fill="none" />
        <path d="M47 33 L56 31 Q59 31, 59 34" stroke="#1a1a24" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      </g>
      {/* Glasses — thin, modern rounded rectangles */}
      <rect x="17" y="29" width="14" height="10" rx="4" fill="none" stroke="#1a1a24" strokeWidth="1" />
      <rect x="33" y="29" width="14" height="10" rx="4" fill="none" stroke="#1a1a24" strokeWidth="1" />
      {/* Bridge */}
      <path d="M31 33 L33 33" stroke="#1a1a24" strokeWidth="0.9" />
      {/* Lens glare */}
      <path d="M20 31 Q22 30, 24 31" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
      <path d="M36 31 Q38 30, 40 31" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />

      {/* Eyes — bigger, blue */}
      <circle cx="24" cy="34" r="3.5" fill="#3868b8" />
      <circle cx="40" cy="34" r="3.5" fill="#3868b8" />
      {/* Pupil */}
      <circle cx="24" cy="34.5" r="1.8" fill="#1a1a2e" />
      <circle cx="40" cy="34.5" r="1.8" fill="#1a1a2e" />
      {/* Eye highlights */}
      <circle cx="25.5" cy="32.8" r="1.3" fill="white" opacity="0.92" />
      <circle cx="41.5" cy="32.8" r="1.3" fill="white" opacity="0.92" />
      <circle cx="22.8" cy="35.2" r="0.5" fill="white" opacity="0.45" />
      <circle cx="38.8" cy="35.2" r="0.5" fill="white" opacity="0.45" />

      {/* Nose hint */}
      <ellipse cx="32" cy="39" rx="1" ry="0.5" fill="#e8c8b0" opacity="0.4" />

      {/* Blush */}
      <ellipse cx="19" cy="40" rx="3.5" ry="2.2" fill="#f0b0a0" opacity="0.3" />
      <ellipse cx="45" cy="40" rx="3.5" ry="2.2" fill="#f0b0a0" opacity="0.3" />

      {/* Smile */}
      <path d="M27 44 Q32 48, 37 44" fill="none" stroke="#d08878" strokeWidth="1.3" strokeLinecap="round" />

      {/* Vinyl sheen */}
      <circle cx="32" cy="34" r="18.5" fill={`url(#${id}-shine)`} />
    </svg>
  );
}
