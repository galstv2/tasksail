export function renderPixelGrid(pixels: (string | null)[][]): JSX.Element[] {
  const rects: JSX.Element[] = [];
  for (let y = 0; y < pixels.length; y++) {
    const row = pixels[y];
    for (let x = 0; x < row.length; x++) {
      const color = row[x];
      if (color) {
        rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />);
      }
    }
  }
  return rects;
}
