export function containsZoomExpression(value) {
  if (!Array.isArray(value)) return false;
  if (value[0] === 'zoom') return true;
  return value.some((item, index) => index > 0 && containsZoomExpression(item));
}

function scaleOutput(output, factor) {
  if (typeof output === 'number' && Number.isFinite(output)) return output * factor;
  if (Array.isArray(output) && !containsZoomExpression(output)) return ['*', output, factor];
  return output;
}

export function scaleMapLibreTextSize(value, scale) {
  const factor = Number(scale);
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1 || value == null) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value * factor;
  if (!Array.isArray(value) || value.length === 0) return value;

  const op = value[0];

  // Camera expressions are valid only when ["zoom"] is the input of a
  // top-level step/interpolate expression. Scale their output branches rather
  // than wrapping the whole expression in ["*", ...], which would make zoom
  // nested and invalid in MapLibre.
  if (op === 'interpolate' && Array.isArray(value[2]) && value[2][0] === 'zoom') {
    const next = value.slice();
    for (let i = 4; i < next.length; i += 2) next[i] = scaleOutput(next[i], factor);
    return next;
  }

  if (op === 'step' && Array.isArray(value[1]) && value[1][0] === 'zoom') {
    const next = value.slice();
    next[2] = scaleOutput(next[2], factor);
    for (let i = 4; i < next.length; i += 2) next[i] = scaleOutput(next[i], factor);
    return next;
  }

  if (op === 'let' && value.length >= 3) {
    const next = value.slice();
    const last = next.length - 1;
    const scaled = scaleMapLibreTextSize(next[last], factor);
    if (scaled !== next[last]) {
      next[last] = scaled;
      return next;
    }
  }

  // Data-only expressions can safely be multiplied. Unknown expressions that
  // contain zoom are left unchanged rather than emitting an invalid style.
  if (containsZoomExpression(value)) return value;
  return ['*', value, factor];
}
