// Maze generation + collision helpers (grid perfect maze)
export function makeMaze(w, h, rng=Math.random){
  // Each cell stores walls: N,E,S,W true means wall exists
  const cells = new Array(w*h).fill(0).map(()=>({N:true,E:true,S:true,W:true, v:false}));
  const idx = (x,y)=> y*w + x;

  const stack = [];
  let cx = Math.floor(rng()*w), cy = Math.floor(rng()*h);
  cells[idx(cx,cy)].v = true;
  stack.push([cx,cy]);

  const dirs = [
    {dx:0,dy:-1,a:"N",b:"S"},
    {dx:1,dy:0,a:"E",b:"W"},
    {dx:0,dy:1,a:"S",b:"N"},
    {dx:-1,dy:0,a:"W",b:"E"},
  ];

  while(stack.length){
    const [x,y] = stack[stack.length-1];
    // collect unvisited neighbors
    const options = [];
    for(const d of dirs){
      const nx = x + d.dx, ny = y + d.dy;
      if(nx<0||ny<0||nx>=w||ny>=h) continue;
      const n = cells[idx(nx,ny)];
      if(!n.v) options.push(d);
    }
    if(!options.length){ stack.pop(); continue; }
    const d = options[Math.floor(rng()*options.length)];
    const nx = x + d.dx, ny = y + d.dy;
    const c = cells[idx(x,y)];
    const n = cells[idx(nx,ny)];
    c[d.a] = false;
    n[d.b] = false;
    n.v = true;
    stack.push([nx,ny]);
  }

  // Utility: farthest cell from start using BFS
  function farthestFrom(sx,sy){
    const dist = new Int32Array(w*h).fill(-1);
    const q = [];
    dist[idx(sx,sy)] = 0;
    q.push([sx,sy]);
    let best = {x:sx,y:sy,d:0};

    while(q.length){
      const [x,y] = q.shift();
      const c = cells[idx(x,y)];
      const base = dist[idx(x,y)];
      if(base > best.d) best = {x,y,d:base};

      const moves = [
        (!c.N ? [0,-1] : null),
        (!c.E ? [1,0] : null),
        (!c.S ? [0,1] : null),
        (!c.W ? [-1,0] : null),
      ].filter(Boolean);

      for(const [dx,dy] of moves){
        const nx=x+dx, ny=y+dy;
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const ii = idx(nx,ny);
        if(dist[ii] !== -1) continue;
        dist[ii] = base+1;
        q.push([nx,ny]);
      }
    }
    return best;
  }

  return {
    w,h,cells, idx,
    farthestFrom
  };
}

// BFS path on the maze grid (returns next step cell)
export function bfsNextStep(maze, from, to){
  const {w,h,cells, idx} = maze;
  const dist = new Int16Array(w*h).fill(-1);
  const prev = new Int32Array(w*h).fill(-1);
  const q = [];
  const s = idx(from.x,from.y);
  const t = idx(to.x,to.y);
  dist[s] = 0;
  q.push(s);

  while(q.length){
    const cur = q.shift();
    if(cur === t) break;
    const x = cur % w;
    const y = (cur / w) | 0;
    const c = cells[cur];

    const neigh = [];
    if(!c.N) neigh.push(idx(x,y-1));
    if(!c.E) neigh.push(idx(x+1,y));
    if(!c.S) neigh.push(idx(x,y+1));
    if(!c.W) neigh.push(idx(x-1,y));

    for(const n of neigh){
      if(n<0 || n>=w*h) continue;
      if(dist[n] !== -1) continue;
      dist[n] = dist[cur] + 1;
      prev[n] = cur;
      q.push(n);
    }
  }

  if(dist[t] === -1) return from;

  // Walk back from target to find the neighbor after 'from'
  let cur = t;
  let p = prev[cur];
  while(p !== -1 && p !== s){
    cur = p;
    p = prev[cur];
  }
  // cur is the step from s towards t
  return { x: cur % w, y: (cur / w) | 0 };
}

// Grid collision resolution (simple + fast)
export function resolveMazeCollision(pos, maze, cellSize, radius){
  const {w,h,cells, idx} = maze;
  const gx = pos.x / cellSize;
  const gy = pos.z / cellSize;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);

  if(cx<0||cy<0||cx>=w||cy>=h) {
    // keep inside bounds
    pos.x = Math.max(radius, Math.min(pos.x, w*cellSize - radius));
    pos.z = Math.max(radius, Math.min(pos.z, h*cellSize - radius));
    return pos;
  }

  const c = cells[idx(cx,cy)];
  const minX = cx*cellSize;
  const minZ = cy*cellSize;
  const maxX = (cx+1)*cellSize;
  const maxZ = (cy+1)*cellSize;

  // If wall exists, push player away from boundary if too close
  if(c.W && pos.x < minX + radius) pos.x = minX + radius;
  if(c.E && pos.x > maxX - radius) pos.x = maxX - radius;
  if(c.N && pos.z < minZ + radius) pos.z = minZ + radius;
  if(c.S && pos.z > maxZ - radius) pos.z = maxZ - radius;

  return pos;
}
