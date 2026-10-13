import type { Mat } from "./util";

/** librosa.segment.agglomerative: Ward clustering of the frames where only neighbouring frames (and the clusters they
 * form) may merge, exactly like sklearn's AgglomerativeClustering(connectivity=grid): the cheapest merge first by
 * n_a*n_b/(n_a+n_b) * |mean_a - mean_b|^2, ties broken by (newer cluster id, older id) as its heap does. Stops at k
 * clusters; returns the frame index where each segment starts. `data` is features x frames. */

type Item = [number, number, number]; // (inertia, row, col)

class Heap {
  private a: Item[] = [];
  private less(x: Item, y: Item) {
    return x[0] < y[0] || (x[0] === y[0] && (x[1] < y[1] || (x[1] === y[1] && x[2] < y[2])));
  }
  push(v: Item) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Item | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export function agglomerative(data: Mat, k: number): number[] {
  const d = data.rows, n = data.cols;
  if (n === 0) return [0];
  k = Math.max(1, Math.min(k, n));
  const nodes = 2 * n - k;
  const count = new Float64Array(nodes);
  const sums: Float64Array[] = new Array(nodes);
  for (let i = 0; i < n; i++) {
    count[i] = 1;
    const v = new Float64Array(d);
    for (let f = 0; f < d; f++) v[f] = data.data[f * n + i];
    sums[i] = v;
  }
  const ward = (a: number, b: number) => {
    const w = (count[a] * count[b]) / (count[a] + count[b]);
    let pa = 0;
    const sa = sums[a], sb = sums[b];
    for (let f = 0; f < d; f++) pa += (sa[f] / count[a] - sb[f] / count[b]) ** 2;
    return pa * w;
  };
  // clusters as a chain: left / right neighbour of each live cluster, and the first frame each covers
  const left = new Int32Array(nodes).fill(-1), right = new Int32Array(nodes).fill(-1), first = new Int32Array(nodes);
  const used = new Uint8Array(nodes).fill(1);
  for (let i = 0; i < n; i++) {
    left[i] = i - 1;
    right[i] = i + 1 < n ? i + 1 : -1;
    first[i] = i;
  }
  const heap = new Heap();
  for (let i = 1; i < n; i++) heap.push([ward(i, i - 1), i, i - 1]);
  for (let node = n; node < nodes; node++) {
    let it: Item | undefined;
    do it = heap.pop(); while (it && !(used[it[1]] && used[it[2]]));
    if (!it) break;
    const [, a, b] = it;
    const lo = first[a] < first[b] ? a : b, hi = lo === a ? b : a; // lo is the left one of the pair
    used[a] = used[b] = 0;
    count[node] = count[a] + count[b];
    const s = new Float64Array(d);
    for (let f = 0; f < d; f++) s[f] = sums[a][f] + sums[b][f];
    sums[node] = s;
    first[node] = first[lo];
    left[node] = left[lo];
    right[node] = right[hi];
    if (left[node] >= 0) right[left[node]] = node;
    if (right[node] >= 0) left[right[node]] = node;
    // sklearn visits the neighbours of i then of j (children order: the popped (row, col))
    const neigh: number[] = [];
    for (const c of [a, b]) for (const x of [left[c], right[c]]) {
      const live = x === lo || x === hi ? -1 : x;
      if (live >= 0 && used[live] && !neigh.includes(live)) neigh.push(live);
    }
    for (const x of [left[node], right[node]]) if (x >= 0 && !neigh.includes(x)) neigh.push(x);
    for (const x of neigh) heap.push([ward(node, x), node, x]);
  }
  const starts: number[] = [];
  for (let i = 0; i < nodes; i++) if (used[i] && sums[i]) starts.push(first[i]);
  return starts.sort((x, y) => x - y);
}
