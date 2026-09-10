/** A packed binary max tree for a spectral row. Leaves remain in the original
 * spectrum; nodes 1..N-1 occupy one additional N-wide texture row. Positive
 * half-float bit patterns are ordered, so the same routine works before or
 * after the renderer's 16-bit texture conversion. */
export function buildPeakTree(source, tree, count = source.length, sourceOffset = 0, treeOffset = 0) {
  const half = count / 2;
  tree[treeOffset] = 0;
  for (let node = half; node < count; node++) {
    const leaf = sourceOffset + (node - half) * 2;
    tree[treeOffset + node] = Math.max(source[leaf], source[leaf + 1]);
  }
  for (let node = half - 1; node > 0; node--) {
    tree[treeOffset + node] = Math.max(tree[treeOffset + node * 2], tree[treeOffset + node * 2 + 1]);
  }
  return tree;
}

/** CPU equivalent of the shader's exact inclusive interval query, useful for
 * numerical checks without WebGL. No narrow source bin can fall between probes. */
export function queryPeakTree(source, tree, first, last) {
  const count = source.length;
  let left = count + Math.max(0, Math.min(count - 1, Math.floor(first)));
  let right = count + Math.max(0, Math.min(count - 1, Math.ceil(last)));
  let maximum = 0;
  const value = node => node >= count ? source[node - count] : tree[node];
  while (left <= right) {
    if (left % 2) maximum = Math.max(maximum, value(left++));
    if (!(right % 2)) maximum = Math.max(maximum, value(right--));
    left = Math.floor(left / 2);
    right = Math.floor(right / 2);
  }
  return maximum;
}
