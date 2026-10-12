export function totalDuration(shots) {
  return shots.reduce((sum, shot) => sum + Math.max(0, Number(shot.duration) || 0), 0);
}

export function frameAt(shots, seconds) {
  let end = 0;
  for (let index = 0; index < shots.length; index += 1) {
    end += Math.max(0, Number(shots[index].duration) || 0);
    if (seconds < end) return index;
  }
  return Math.max(0, shots.length - 1);
}
