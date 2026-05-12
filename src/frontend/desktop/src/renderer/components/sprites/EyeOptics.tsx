// Shared eye optics for robot sprites. Two render paths so sub-pixel features (bezel ring, hex iris, crosshairs)
// don't vanish at modal sizes — when size < SMALL_VARIANT_THRESHOLD, the eye collapses to socket + enlarged pupil + highlight.

const SMALL_VARIANT_THRESHOLD = 48;

interface EyeOpticsProps {
  size: number;
  socketFill: string;
  bezelStroke: string;
  irisFill: string;
  irisStroke: string;
  pupilFill: string;
  highlightFill: string;
  crosshairStroke: string;
}

interface EyeProps extends Omit<EyeOpticsProps, 'size'> {
  cx: number;
  cy: number;
  small: boolean;
}

function Eye({
  cx,
  cy,
  small,
  socketFill,
  bezelStroke,
  irisFill,
  irisStroke,
  pupilFill,
  highlightFill,
  crosshairStroke,
}: EyeProps): JSX.Element {
  if (small) {
    return (
      <g>
        <circle cx={cx} cy={cy} r="4" fill={socketFill} />
        <circle cx={cx} cy={cy} r="2.3" fill={pupilFill} />
        <circle cx={cx} cy={cy} r="1.3" fill={highlightFill} />
      </g>
    );
  }
  const hex = `${cx},${cy - 3} ${cx + 2.6},${cy - 1.5} ${cx + 2.6},${cy + 1.5} ${cx},${cy + 3} ${cx - 2.6},${cy + 1.5} ${cx - 2.6},${cy - 1.5}`;
  return (
    <g>
      <circle cx={cx} cy={cy} r="4" fill={socketFill} />
      <circle cx={cx} cy={cy} r="3.5" fill="none" stroke={bezelStroke} strokeWidth="0.4" opacity="0.55" />
      <polygon points={hex} fill={irisFill} stroke={irisStroke} strokeWidth="0.3" />
      <circle cx={cx} cy={cy} r="1.4" fill={pupilFill} />
      <circle cx={cx} cy={cy} r="0.7" fill={highlightFill} />
      <line x1={cx - 1.6} y1={cy} x2={cx + 1.6} y2={cy} stroke={crosshairStroke} strokeWidth="0.3" opacity="0.6" />
      <line x1={cx} y1={cy - 1.6} x2={cx} y2={cy + 1.6} stroke={crosshairStroke} strokeWidth="0.3" opacity="0.6" />
    </g>
  );
}

export function EyeOptics(props: EyeOpticsProps): JSX.Element {
  const { size, ...tokens } = props;
  const small = size < SMALL_VARIANT_THRESHOLD;
  return (
    <g>
      <Eye cx={24} cy={33} small={small} {...tokens} />
      <Eye cx={40} cy={33} small={small} {...tokens} />
    </g>
  );
}
